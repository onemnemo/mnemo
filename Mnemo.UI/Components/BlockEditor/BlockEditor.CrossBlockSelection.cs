using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Avalonia.Layout;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Formatting;
using Mnemo.Core.History;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.UI.Components.BlockEditor.History;
using Mnemo.UI.Services;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockEditor
{
    /// <summary>
    /// Document-order leaf index of the block at <paramref name="point"/> (editor coordinates).
    /// <para>
    /// Iterates only the ~8-17 realized (mounted) containers instead of all 1500 document blocks,
    /// reducing the hot-path cost from O(N) to O(realized). When the pointer falls in a gap
    /// between realized blocks the nearest block by Y is returned so cross-block drag selection
    /// stays stable rather than returning -1 and stalling the update.
    /// </para>
    /// Returns -1 only when no realized blocks are available at all.
    /// </summary>
    private int GetBlockIndexAtPoint(Point point)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        var checkedBlocks = 0;

        var docIndexLookup = GetDocIndexLookup();

        int exactMatch = -1;
        int nearestDocIndex = -1;
        // Track 2D rect distance, not just Y. SplitBlockRowView places L/R column children at the
        // same Y bands; with Y-only distance, blocks in the *opposite* column tied with same-Y
        // siblings, and dictionary iteration order picked the winner non-deterministically. That
        // caused cross-block selection to jump across the row (and past the gap into Block N+1)
        // when the pointer was in a gap, even though the cursor never crossed those blocks.
        double nearestDistSq = double.MaxValue;
        int nearestTiebreakDistDocIndex = int.MaxValue;
        double lowestBottom = double.MinValue;
        int lowestDocIndex = -1;

        foreach (var (vm, editableBlock) in _realizedBlocksByVm)
        {
            checkedBlocks++;
            if (!ReferenceEquals(editableBlock.DataContext, vm)) continue;
            if (!docIndexLookup.TryGetValue(vm, out int docIndex)) continue;

            var rect = GetControlBoundsInEditor(editableBlock);
            if (rect.Width <= 0 || rect.Height <= 0) continue;

            double bottom = rect.Y + rect.Height;
            double right = rect.X + rect.Width;

            // Track the realized block with the greatest bottom edge for the "tail" fallback.
            // Must be updated for every realized block regardless of exact-hit state so the
            // "below realized" guard knows whether the lowest realized block is the document tail.
            if (bottom > lowestBottom)
            {
                lowestBottom = bottom;
                lowestDocIndex = docIndex;
            }

            // Exact hit: point is inside this block's bounds.
            if (exactMatch < 0 && rect.Contains(point))
                exactMatch = docIndex;

            // Gap handling: track the nearest realized block by 2D distance so drag selection
            // does not stall when the pointer is between two blocks. Use squared euclidean
            // distance to the rect (0 inside, otherwise distance to nearest edge).
            double dx = point.X < rect.X
                ? rect.X - point.X
                : point.X > right ? point.X - right : 0.0;
            double dy = point.Y < rect.Y
                ? rect.Y - point.Y
                : point.Y > bottom ? point.Y - bottom : 0.0;
            double distSq = dx * dx + dy * dy;

            // Deterministic tiebreaker on equal distance: prefer the realized block whose docIndex
            // is closest to the previous endpoint (so a downward drag through a column row gap
            // doesn't snap to right-column children when the pointer is in the left column gap).
            int tiebreakDist = _lastCrossBlockCurrentIndex >= 0
                ? Math.Abs(docIndex - _lastCrossBlockCurrentIndex)
                : docIndex;

            if (distSq < nearestDistSq
                || (distSq == nearestDistSq && tiebreakDist < nearestTiebreakDistDocIndex))
            {
                nearestDistSq = distSq;
                nearestTiebreakDistDocIndex = tiebreakDist;
                nearestDocIndex = docIndex;
            }
        }

        int result;
        string resultTag;

        if (exactMatch >= 0)
        {
            result = exactMatch;
            resultTag = $"{result}";
        }
        else if (lowestDocIndex < 0)
        {
            // No realized blocks at all (empty editor or all scrolled out).
            result = -1;
            resultTag = "-1";
        }
        else if (point.Y >= lowestBottom)
        {
            // Pointer is below all currently realized blocks.
            // Only signal "past end" (doc.Count) when the lowest realized block is actually the
            // last block in the document. In a virtualized list the lowest *realized* block is
            // often just the bottom of the visible viewport, and returning doc.Count from there
            // would snap cross-block selection all the way to block 1499, which is incorrect.
            var doc = GetDocumentOrderBlocks();
            if (lowestDocIndex == doc.Count - 1)
            {
                result = doc.Count;
                resultTag = "tail";
            }
            else
            {
                // Still inside the virtualized document; clamp to the last realized block so
                // selection extends to the visible edge without jumping past unrealized blocks.
                result = lowestDocIndex;
                resultTag = $"{result}(below-realized)";
            }
        }
        else
        {
            // Pointer is in a gap between realized blocks; snap to the nearest one so drag
            // selection remains continuous instead of returning -1 and freezing the update.
            result = nearestDocIndex;
            resultTag = $"{result}(nearest)";
        }

        if (perfStart != 0)
        {
            EditorPerfDiagnostics.ReportInteraction(
                perf,
                "getBlockIndexAtPoint",
                EditorPerfDiagnostics.ElapsedMs(perfStart),
                $"checked={checkedBlocks} realized={_realizedBlocksByVm.Count} result={resultTag}");
        }
        return result;
    }

    /// <summary>
    /// Clears text selection (SelectionStart/SelectionEnd) in every block except the one at exceptBlockIndex.
    /// Pass -1 to clear all blocks. Used so a new press or click on empty space clears previous cross-block selection.
    /// </summary>
    internal void ClearTextSelectionInAllBlocksExcept(BlockViewModel? exceptBlock)
    {
        // Only realized blocks have a RichTextEditor / selection to clear. Walking the full
        // document used to be O(N) calls into GetEditableBlockForViewModel, each cache-miss
        // scanning all row indices, O(N squared) with virtualization on large notes.
        foreach (var kv in _realizedBlocksByVm)
        {
            var vm = kv.Key;
            var eb = kv.Value;
            if (exceptBlock != null && ReferenceEquals(vm, exceptBlock))
                continue;
            if (!ReferenceEquals(eb.DataContext, vm))
                continue;
            eb.ApplyTextSelection(0, 0);
        }
    }

    private void UpdateCrossBlockSelection(Point currentPoint)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        var checkedBlocks = 0;
        var appliedBlocks = 0;

        int anchorIndex = _crossBlockAnchorBlockIndex;
        if (anchorIndex < 0 || _crossBlockAnchorBlock == null) return;

        // Use cached doc list (O(1) after first build). GetBlockIndexAtPoint and the hysteresis
        // check both need indexed access, so we still need the list, but we avoid re-allocating it.
        var docList = GetDocumentOrderBlocks();
        int rawIndex = GetBlockIndexAtPoint(currentPoint);
        if (rawIndex < 0) return;
        rawIndex = Math.Clamp(rawIndex, 0, Math.Max(0, docList.Count - 1));

        int currentIndex = rawIndex;
        if (_lastCrossBlockCurrentIndex >= 0 && _lastCrossBlockCurrentIndex < docList.Count)
        {
            var rect = GetControlBoundsInEditor(GetEditableBlockForViewModel(docList[_lastCrossBlockCurrentIndex]));
            if (rect.Width > 0 && rect.Height > 0 && rect.Contains(currentPoint))
                currentIndex = _lastCrossBlockCurrentIndex;
        }
        _lastCrossBlockCurrentIndex = currentIndex;

        int anchorChar = _crossBlockAnchorCharIndex;
        bool forward = currentIndex >= anchorIndex;
        int startIdx = Math.Min(anchorIndex, currentIndex);
        int endIdx = Math.Max(anchorIndex, currentIndex);

        // Text selection only: never use block selection (IsSelected).
        // ClearBlockSelection walks document order, so cells nested in two-column rows are
        // cleared too (iterating only top-level Blocks left them highlighted).
        ClearBlockSelection();

        // Interact only with realized blocks, typically ~8-17 out of 1500+.
        // Non-realized blocks have no live RichTextEditor, so ApplyTextSelection is a no-op for them;
        // when they scroll back into view they start fresh with no selection applied.
        var docIndexLookup = GetDocIndexLookup();
        foreach (var (vm, editableBlock) in _realizedBlocksByVm)
        {
            checkedBlocks++;
            // Guard against stale registrations (virtualization recycles containers).
            if (!ReferenceEquals(editableBlock.DataContext, vm)) continue;
            if (!docIndexLookup.TryGetValue(vm, out int i)) continue;
            appliedBlocks++;

            // Blocks outside the selection range must be explicitly cleared so that shrinking
            // the selection (e.g. dragging back toward the anchor) removes highlights correctly.
            if (i < startIdx || i > endIdx)
            {
                editableBlock.ApplyTextSelection(0, 0);
                continue;
            }

            int len = editableBlock.GetLogicalTextLengthForCrossBlockSelection();

            if (anchorIndex == currentIndex)
            {
                // Single block: select text from anchor to current point
                var ptInBlock = this.TranslatePoint(currentPoint, editableBlock);
                int curChar = ptInBlock.HasValue ? editableBlock.GetCharacterIndexFromPoint(ptInBlock.Value) : -1;
                if (curChar < 0)
                    curChar = anchorChar;
                int selStart = Math.Min(anchorChar, curChar);
                int selEnd = Math.Max(anchorChar, curChar);
                editableBlock.ApplyTextSelection(selStart, selEnd);
            }
            else if (i == anchorIndex)
            {
                // Anchor block: text from anchor to end (forward) or start to anchor (backward)
                if (forward)
                    editableBlock.ApplyTextSelection(anchorChar, len);
                else
                    editableBlock.ApplyTextSelection(0, anchorChar);
            }
            else if (i == currentIndex)
            {
                // Endpoint block: text from start to current point (forward) or current point to end (backward)
                var ptInBlock = this.TranslatePoint(currentPoint, editableBlock);
                int curChar = ptInBlock.HasValue ? editableBlock.GetCharacterIndexFromPoint(ptInBlock.Value) : -1;
                // Hit-test failure (row virtualizing, layout in flight): treat the endpoint block as
                // fully covered instead of collapsing its selection to the block start.
                if (curChar < 0)
                    curChar = forward ? len : 0;
                curChar = Math.Clamp(curChar, 0, len);
                if (forward)
                    editableBlock.ApplyTextSelection(0, curChar);
                else
                    editableBlock.ApplyTextSelection(curChar, len);
            }
            else
            {
                // Intermediate blocks: select all text in the block
                editableBlock.ApplyTextSelection(0, len);
            }
        }

        if (perfStart != 0)
        {
            EditorPerfDiagnostics.ReportInteraction(
                perf,
                "updateCrossBlockSelection",
                EditorPerfDiagnostics.ElapsedMs(perfStart),
                $"checked={checkedBlocks} applied={appliedBlocks} anchor={anchorIndex} current={currentIndex} realized={RealizedRowCount}");
        }
    }
}