using Avalonia.Threading;
using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockEditor
{
    private void DeleteSelectedBlocks()
    {
        var doc = GetDocumentOrderBlocks();
        var toRemove = doc.Where(b => b.IsSelected).ToList();
        if (toRemove.Count == 0) return;
        var firstRemovedDocIndex = doc.FindIndex(b => b.IsSelected);

        BeginStructuralChange();

        var topLevel = toRemove.Where(b => b.OwnerTwoColumn == null).OrderByDescending(b => Blocks.IndexOf(b)).ToList();
        foreach (var block in topLevel)
        {
            UnsubscribeFromBlock(block, registerReleasedStoredImagePath: true);
            Blocks.Remove(block);
        }

        var bySplit = new Dictionary<TwoColumnBlockViewModel, List<BlockViewModel>>();
        foreach (var block in toRemove.Where(b => b.OwnerTwoColumn is TwoColumnBlockViewModel))
        {
            var tc = (TwoColumnBlockViewModel)block.OwnerTwoColumn!;
            if (!bySplit.TryGetValue(tc, out var list))
            {
                list = new List<BlockViewModel>();
                bySplit[tc] = list;
            }
            list.Add(block);
        }

        foreach (var kv in bySplit)
        {
            var tc = kv.Key;
            var parts = kv.Value;
            if (Blocks.IndexOf(tc) < 0)
                continue;

            // Remove only the selected cells first. Removing the whole split row whenever both
            // columns were touched destroyed unselected sibling cells with it.
            foreach (var cell in parts)
            {
                var col = cell.IsLeftColumn ? tc.LeftColumnBlocks : tc.RightColumnBlocks;
                if (!col.Contains(cell)) continue;
                UnsubscribeFromBlock(cell, registerReleasedStoredImagePath: true);
                col.Remove(cell);
                BlockHierarchy.ClearChildOwnership(cell);
            }

            if (Blocks.IndexOf(tc) < 0)
                continue;

            var leftEmpty = tc.LeftColumnBlocks.Count == 0;
            var rightEmpty = tc.RightColumnBlocks.Count == 0;
            if (leftEmpty && rightEmpty)
            {
                var topIdx = Blocks.IndexOf(tc);
                UnsubscribeFromBlock(tc, registerReleasedStoredImagePath: true);
                Blocks.RemoveAt(topIdx);
            }
            else if (leftEmpty)
                UnwrapTwoColumnPromotingFilledColumn(tc, filledColumnIsLeft: false);
            else if (rightEmpty)
                UnwrapTwoColumnPromotingFilledColumn(tc, filledColumnIsLeft: true);

            ReorderBlocks();
        }

        if (Blocks.Count == 0)
        {
            var defaultBlock = BlockFactory.CreateBlock(BlockType.Text, 0);
            SubscribeToBlock(defaultBlock);
            Blocks.Add(defaultBlock);
            Dispatcher.UIThread.Post(() => defaultBlock.IsFocused = true, DispatcherPriority.Input);
        }
        else
        {
            // Focus the block adjacent to the deleted range, not the first block in the document;
            // focusing the first block scrolls the viewport all the way to the top.
            var docAfter = BlockHierarchy.EnumerateInDocumentOrder(Blocks).ToList();
            var focusTarget = docAfter.Count > 0
                ? docAfter[Math.Clamp(firstRemovedDocIndex - 1, 0, docAfter.Count - 1)]
                : null;
            if (focusTarget != null)
                Dispatcher.UIThread.Post(() => focusTarget.IsFocused = true, DispatcherPriority.Input);
        }

        ReorderBlocks();
        ClearBlockSelection();
        CommitStructuralChange("Delete selected blocks");
        BlocksChanged?.Invoke();
    }

    public bool HasCrossBlockTextSelection()
    {
        foreach (var vm in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            var rte = GetEditableBlockForViewModel(vm)?.TryGetRichTextEditor();
            if (rte != null && EditableBlock.HasActiveTextSelection(rte))
                return true;
        }
        return false;
    }

    /// <summary>
    /// True when Backspace should be handled by the editor-level text-selection delete:
    /// the selection spans multiple blocks, or lives in a block that won't receive the key.
    /// A selection inside the focused block is left to its RichTextEditor so the delete lands
    /// in the typing batch as a single undo/redo operation.
    /// </summary>
    private bool ShouldHandleBackspaceAsTextSelectionDelete()
    {
        BlockViewModel? single = null;
        foreach (var vm in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            var rte = GetEditableBlockForViewModel(vm)?.TryGetRichTextEditor();
            if (rte == null || !EditableBlock.HasActiveTextSelection(rte))
                continue;
            if (single != null)
                return true;
            single = vm;
        }
        return single is { IsFocused: false };
    }

    /// <summary>True if any block in the cross-block text selection overlaps linked text.</summary>
    public bool CrossBlockTextSelectionHasLink()
    {
        foreach (var vm in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            var eb = GetEditableBlockForViewModel(vm);
            if (eb?.GetSelectionRange() == null) continue;
            if (eb.DoesSelectionHaveLink()) return true;
        }
        return false;
    }

    /// <summary>First <c>LinkUrl</c> found in any block that has a text selection (cross-block link edit).</summary>
    public string? TryGetFirstLinkUrlInCrossBlockSelection()
    {
        foreach (var vm in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            var eb = GetEditableBlockForViewModel(vm);
            if (eb?.GetSelectionRange() is not { } sel) continue;
            var url = GetLinkUrlInRuns(vm.Spans, sel.start, sel.end);
            if (!string.IsNullOrEmpty(url)) return url;
        }
        return null;
    }

    private static string? GetLinkUrlInRuns(IReadOnlyList<InlineSpan> runs, int start, int end)
    {
        int pos = 0;
        foreach (var seg in runs)
        {
            if (seg is not TextSpan run)
            {
                pos += 1;
                continue;
            }

            int re = pos + run.Text.Length;
            if (re > start && pos < end && run.Style.LinkUrl != null)
                return run.Style.LinkUrl;
            pos = re;
        }
        return null;
    }

    public void ApplyInlineFormatToCrossBlockSelection(Mnemo.Core.Formatting.InlineFormatKind kind, string? color = null)
    {
        BeginStructuralChange();
        _isApplyingCrossBlockFormat = true;
        try
        {
            var doc = GetDocumentOrderBlocks();
            for (int i = 0; i < doc.Count; i++)
            {
                var editableBlock = GetEditableBlockForViewModel(doc[i]);
                if (editableBlock?.GetSelectionRange() != null)
                    editableBlock.ApplyInlineFormatInternal(kind, color);
            }
        }
        finally
        {
            _isApplyingCrossBlockFormat = false;
        }

        CommitStructuralChange("Format Selection");
    }

    private void TryDeleteTextSelection()
    {
        var focused = BlockHierarchy.FindFocused(Blocks);
        BlockViewModel? focusAfterDelete = null;
        if (focused != null)
        {
            var focusedRte = GetEditableBlockForViewModel(focused)?.TryGetRichTextEditor();
            if (focusedRte != null && EditableBlock.HasActiveTextSelection(focusedRte))
                focusAfterDelete = focused;
        }

        foreach (var block in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            var editableBlock = GetEditableBlockForViewModel(block);
            if (editableBlock?.TryGetRichTextEditor() is not { } rte || !EditableBlock.HasActiveTextSelection(rte))
                continue;

            focusAfterDelete ??= block;
            editableBlock.DeleteSelection();
        }

        RemoveEmptyBlocksAfterTextDelete(focusAfterDelete);
    }

    /// <summary>
    /// Removes empty blocks after a text-delete operation, but keeps the first block that had
    /// selection (even if empty) and focuses it.
    /// </summary>
    private void RemoveEmptyBlocksAfterTextDelete(BlockViewModel? firstBlockInDeletion)
    {
        var docOrder = BlockHierarchy.EnumerateInDocumentOrder(Blocks).ToList();
        var toRemove = new List<BlockViewModel>();
        foreach (var block in docOrder)
        {
            if (block.Type is BlockType.TwoColumn or BlockType.Divider)
                continue;
            if (!BlockEditorContentPolicy.IsVisuallyEmpty(block.Content))
                continue;
            if (firstBlockInDeletion != null && ReferenceEquals(block, firstBlockInDeletion))
                continue;
            toRemove.Add(block);
        }

        if (toRemove.Count == 0 && Blocks.Count > 0)
        {
            // Pure text delete, nothing structural changed. The deletion is already captured by
            // the typing batch; wrapping it in Begin/CommitStructuralChange would push a second
            // (no-op) DocumentOperation so undo/redo of a selection delete would take two steps.
            FlushTypingBatch();
            if (firstBlockInDeletion != null)
            {
                Dispatcher.UIThread.Post(
                    () => firstBlockInDeletion.IsFocused = true,
                    DispatcherPriority.Input);
            }
            ClearBlockSelection();
            BlocksChanged?.Invoke();
            return;
        }

        BeginStructuralChange();

        var toRemoveSet = new HashSet<BlockViewModel>(toRemove);
        for (int i = docOrder.Count - 1; i >= 0; i--)
        {
            var block = docOrder[i];
            if (!toRemoveSet.Contains(block)) continue;
            RemoveEmptyBlockCellForTextDelete(block);
        }

        if (Blocks.Count == 0)
        {
            var defaultBlock = BlockFactory.CreateBlock(BlockType.Text, 0);
            SubscribeToBlock(defaultBlock);
            Blocks.Add(defaultBlock);
            Dispatcher.UIThread.Post(
                () => defaultBlock.IsFocused = true,
                DispatcherPriority.Input);
        }
        else
        {
            var focusTarget = firstBlockInDeletion != null && BlockHierarchy.FindById(Blocks, firstBlockInDeletion.Id) != null
                ? firstBlockInDeletion
                : BlockHierarchy.EnumerateInDocumentOrder(Blocks).FirstOrDefault();
            if (focusTarget != null)
            {
                Dispatcher.UIThread.Post(
                    () => focusTarget.IsFocused = true,
                    DispatcherPriority.Input);
            }
        }

        ReorderBlocks();
        ClearBlockSelection();
        CommitStructuralChange("Delete text selection");
        BlocksChanged?.Invoke();
    }

    private void RemoveEmptyBlockCellForTextDelete(BlockViewModel block)
    {
        if (block.OwnerTwoColumn is TwoColumnBlockViewModel tc)
        {
            var col = block.IsLeftColumn ? tc.LeftColumnBlocks : tc.RightColumnBlocks;
            var ci = col.IndexOf(block);
            if (ci < 0) return;

            if (col.Count == 1 && tc.LeftColumnBlocks.Count + tc.RightColumnBlocks.Count == 1)
            {
                var topIdx = Blocks.IndexOf(tc);
                if (topIdx < 0) return;
                UnsubscribeFromBlock(tc, registerReleasedStoredImagePath: true);
                Blocks.RemoveAt(topIdx);
                var placeholder = BlockFactory.CreateBlock(BlockType.Text, 0);
                SubscribeToBlock(placeholder);
                Blocks.Insert(topIdx, placeholder);
                ReorderBlocks();
                return;
            }

            UnsubscribeFromBlock(block, registerReleasedStoredImagePath: true);
            col.RemoveAt(ci);
            BlockHierarchy.ClearChildOwnership(block);
            if (col.Count == 0)
            {
                var other = block.IsLeftColumn ? tc.RightColumnBlocks : tc.LeftColumnBlocks;
                if (other.Count > 0)
                {
                    // Emptying a column dissolves the split (same rule as DeleteBlock).
                    UnwrapTwoColumnPromotingFilledColumn(tc, !block.IsLeftColumn);
                    return;
                }

                var ph = BlockFactory.CreateBlock(BlockType.Text, 0);
                BlockHierarchy.WireChildOwnership(tc, ph, block.IsLeftColumn);
                col.Add(ph);
                SubscribeToBlock(ph);
            }
            ReorderBlocks();
            return;
        }

        var index = Blocks.IndexOf(block);
        if (index == -1) return;

        if (Blocks.Count == 1)
        {
            block.Content = string.Empty;
            block.Type = BlockType.Text;
            return;
        }

        UnsubscribeFromBlock(block, registerReleasedStoredImagePath: true);
        Blocks.Remove(block);
        ReorderBlocks();
    }
}
