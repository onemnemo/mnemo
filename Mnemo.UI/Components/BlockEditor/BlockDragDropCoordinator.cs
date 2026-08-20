using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Block reorder drag-and-drop: magnetic gap bands, split/column drop targets, and drop execution.
/// </summary>
internal sealed class BlockDragDropCoordinator
{
    private readonly BlockEditor _host;

    internal BlockDragDropCoordinator(BlockEditor host) => _host = host;

    
    private int _currentDropInsertIndex = -1;
    private EditableBlock? _currentDropIndicatorBlock;
    private BlockViewModel? _splitDropTargetBlock;
    private bool _splitDropLeftEdge;
    private TwoColumnBlockViewModel? _columnDropTarget;
    private bool _columnDropLeft;
    private int _columnDropInsertIndex = -1;

    internal TwoColumnBlockViewModel? ColumnDropTarget
    {
        get => _columnDropTarget;
        set => _columnDropTarget = value;
    }

    internal bool ColumnDropLeft
    {
        get => _columnDropLeft;
        set => _columnDropLeft = value;
    }

    internal int ColumnDropInsertIndex
    {
        get => _columnDropInsertIndex;
        set => _columnDropInsertIndex = value;
    }

    internal int DropInsertIndex
    {
        get => _currentDropInsertIndex;
        set => _currentDropInsertIndex = value;
    }

    // Fraction of block height that acts as a "snap-to-boundary" zone.
    // Only the top/bottom portion triggers an insert-before/after decision;
    // the middle portion keeps the current indicator to prevent flicker on
    // multi-line blocks where the midpoint sits inside visible text.
    private const double SnapBandFraction = 0.25;
    private const double HorizontalDropLineHeight = 3;
    private const double BlockReorderCommitThresholdPixels = 24;

    /// <summary>
    /// Called by EditableBlock on DragOver. Computes insert index from cursor Y using
    /// snap-band boundaries with hysteresis and updates the drop indicator line.
    /// </summary>
    public void HandleBlockDragOver(Point cursorPosInEditor, BlockViewModel.BlockReorderDragPayload payload)
    {
        if (payload.BlocksInDocumentOrder.Count == 0 || _host.Blocks.Count == 0)
        {
            ClearDropIndicator();
            return;
        }

        var primary = payload.Primary;
        if (payload.DragStartPointInEditor is { } start)
        {
            var dx = cursorPosInEditor.X - start.X;
            var dy = cursorPosInEditor.Y - start.Y;
            if (Math.Sqrt(dx * dx + dy * dy) < BlockReorderCommitThresholdPixels)
            {
                ClearDropIndicator();
                return;
            }
        }

        if (payload.BlocksInDocumentOrder.Count == 1
            && TryUpdateSplitDropIndicator(cursorPosInEditor, primary))
            return;

        _splitDropTargetBlock = null;

        if (payload.BlocksInDocumentOrder.Count == 1
            && primary.OwnerTwoColumn is TwoColumnBlockViewModel otcSnap
            && TryGetTopLevelInsertInSplitRowSnapBand(cursorPosInEditor.Y, otcSnap, out var snapInsert))
        {
            ClearDropIndicator();
            _currentDropInsertIndex = snapInsert;
            ShowHorizontalReorderDropLineInOverlay(snapInsert);
            return;
        }

        if (payload.BlocksInDocumentOrder.Count == 1
            && TryUpdateColumnDropIndicator(cursorPosInEditor, primary))
            return;

        if (_columnDropTarget != null)
            ClearDropIndicator();

        var insertIndex = GetInsertIndex(cursorPosInEditor.Y);
        if (insertIndex < 0)
        {
            ClearDropIndicator();
            return;
        }

        var sortedIndices = payload.BlocksInDocumentOrder
            .Select(b => _host.Blocks.IndexOf(b))
            .Where(i => i >= 0)
            .OrderBy(i => i)
            .ToList();
        if (sortedIndices.Count == 0)
        {
            if (payload.BlocksInDocumentOrder.Count != 1 || primary.OwnerTwoColumn is not TwoColumnBlockViewModel otc)
            {
                ClearDropIndicator();
                return;
            }
            var ti = _host.Blocks.IndexOf(otc);
            if (ti < 0)
            {
                ClearDropIndicator();
                return;
            }
            sortedIndices = new List<int> { ti };
        }

        int gMin = sortedIndices[0];
        int gMax = sortedIndices[^1];
        bool contiguous = sortedIndices.Count == gMax - gMin + 1;
        bool nestedDrag = payload.BlocksInDocumentOrder.Count == 1 && primary.OwnerTwoColumn != null;

        if (contiguous && insertIndex >= gMin && insertIndex <= gMax + 1 && !nestedDrag)
        {
            ClearDropIndicator();
            return;
        }

        // Single-block: suppress when dropping on the same slot as now (pair split edge cases preserved).
        if (payload.BlocksInDocumentOrder.Count == 1)
        {
            var draggedBlock = primary;
            var draggedIndex = _host.Blocks.IndexOf(draggedBlock);
            if (draggedIndex >= 0 && insertIndex == draggedIndex)
            {
                ClearDropIndicator();
                return;
            }

            if (draggedIndex >= 0 && insertIndex == draggedIndex + 1)
            {
                var sib = draggedBlock.GetColumnSibling(_host.Blocks);
                if (sib == null || _host.Blocks.IndexOf(sib) == draggedIndex + 1)
                {
                    ClearDropIndicator();
                    return;
                }
            }
        }

        if (_splitDropTargetBlock == null
            && _columnDropTarget == null
            && insertIndex == _currentDropInsertIndex
            && _host.FindControl<Border>("BlockReorderDropLineOverlay") is { IsVisible: true })
            return;

        ClearDropIndicator();
        _currentDropInsertIndex = insertIndex;

        ShowHorizontalReorderDropLineInOverlay(insertIndex);
    }

    /// <summary>
    /// Horizontal insert-before/after line in <see cref="BlockDragGhostOverlay"/> space (full row width, including split rows).
    /// </summary>
    internal void ShowHorizontalReorderDropLineInOverlay(int insertIndex)
    {
        var overlay = _host.FindControl<LayoutOverlayPanel>("BlockDragGhostOverlay");
        var line = _host.FindControl<Border>("BlockReorderDropLineOverlay");
        if (overlay == null || line == null) return;

        var rowContainer = GetRowContainerForInsertIndex(insertIndex);
        if (rowContainer == null) return;

        var origin = rowContainer.TranslatePoint(new Point(0, 0), overlay);
        if (!origin.HasValue) return;

        double w = rowContainer.Bounds.Width;
        double rowH = rowContainer.Bounds.Height;
        if (w <= 0 || rowH <= 0) return;

        double y = insertIndex < _host.Blocks.Count
            ? origin.Value.Y
            : origin.Value.Y + rowH - HorizontalDropLineHeight;

        line.Width = w;
        line.Height = HorizontalDropLineHeight;
        Canvas.SetLeft(line, origin.Value.X);
        Canvas.SetTop(line, y);
        line.IsVisible = true;
        overlay.InvalidateArrange();
    }

    /// <summary>
    /// Returns the current insert index (for drop). -1 if not over a valid region.
    /// </summary>
    public int CurrentDropInsertIndex => _currentDropInsertIndex;

    /// <summary>
    /// Called when drag leaves the editor or drop completes.
    /// </summary>
    public void ClearDropIndicator()
    {
        _splitDropTargetBlock = null;
        _columnDropTarget = null;
        _columnDropInsertIndex = -1;
        if (_host.FindControl<Border>("BlockReorderDropLineOverlay") is { } dropLine)
        {
            dropLine.IsVisible = false;
            _host.FindControl<LayoutOverlayPanel>("BlockDragGhostOverlay")?.InvalidateArrange();
        }
        if (_currentDropIndicatorBlock != null)
        {
            _currentDropIndicatorBlock.HideDropLine();
            _currentDropIndicatorBlock = null;
        }
        _currentDropInsertIndex = -1;
    }

    /// <summary>Begin undo group for dragging the column splitter (pointer down).</summary>
    public void BeginColumnSplitResize()
    {
        _host._isColumnSplitResizing = true;
        _host.BeginStructuralChange();
    }

    /// <summary>Commit undo group after column splitter release.</summary>
    public void CommitColumnSplitResize()
    {
        _host._isColumnSplitResizing = false;
        _host.CommitStructuralChange("Resize columns");
        _host.NotifyBlocksChanged();
    }

    /// <summary>Build reorder payload: Ctrl/Meta + multi-selection moves all selected (column pairs expanded).</summary>
    internal BlockViewModel.BlockReorderDragPayload CreateBlockReorderPayload(BlockViewModel handleVm, KeyModifiers mods, Point? dragStartPointInEditor = null)
    {
        bool group = (mods & (KeyModifiers.Control | KeyModifiers.Meta)) != 0;
        if (!group || !handleVm.IsSelected)
        {
            return new BlockViewModel.BlockReorderDragPayload
            {
                Primary = handleVm,
                BlocksInDocumentOrder = new[] { handleVm },
                DragStartPointInEditor = dragStartPointInEditor
            };
        }

        var selected = BlockHierarchy.EnumerateInDocumentOrder(_host.Blocks).Where(b => b.IsSelected).ToList();
        if (selected.Count < 2)
        {
            return new BlockViewModel.BlockReorderDragPayload
            {
                Primary = handleVm,
                BlocksInDocumentOrder = new[] { handleVm },
                DragStartPointInEditor = dragStartPointInEditor
            };
        }

        var expanded = new HashSet<BlockViewModel>(selected);
        bool changed = true;
        while (changed)
        {
            changed = false;
            foreach (var vm in expanded.ToList())
            {
                var sib = vm.GetColumnSibling(_host.Blocks);
                if (sib != null && expanded.Add(sib))
                    changed = true;
            }
        }

        var docOrder = _host.GetDocumentOrderBlocks();
        var ordered = expanded.OrderBy(b =>
        {
            var i = docOrder.IndexOf(b);
            return i < 0 ? int.MaxValue : i;
        }).ToList();
        return new BlockViewModel.BlockReorderDragPayload
        {
            Primary = handleVm,
            BlocksInDocumentOrder = ordered,
            DragStartPointInEditor = dragStartPointInEditor
        };
    }

    /// <summary>
    /// Perform the drop: split into columns, or move block(s) to CurrentDropInsertIndex.
    /// </summary>
    public bool TryPerformDrop(BlockViewModel draggedBlock) =>
        TryPerformDrop(new BlockViewModel.BlockReorderDragPayload
        {
            Primary = draggedBlock,
            BlocksInDocumentOrder = new[] { draggedBlock }
        });

    /// <summary>Reorder using payload from drag (single or multi-block).</summary>
    public bool TryPerformDrop(BlockViewModel.BlockReorderDragPayload payload)
    {
        if (_splitDropTargetBlock != null)
        {
            if (payload.BlocksInDocumentOrder.Count != 1)
            {
                ClearDropIndicator();
                return false;
            }

            var ok = TryPerformSplitDrop(payload.Primary, _splitDropTargetBlock, _splitDropLeftEdge);
            ClearDropIndicator();
            return ok;
        }

        if (_columnDropTarget != null && _columnDropInsertIndex >= 0)
        {
            if (payload.BlocksInDocumentOrder.Count != 1)
            {
                ClearDropIndicator();
                return false;
            }

            var ok = TryPerformColumnDrop(payload.Primary, _columnDropTarget, _columnDropLeft, _columnDropInsertIndex);
            ClearDropIndicator();
            return ok;
        }

        if (payload.BlocksInDocumentOrder.Count == 1)
            return TryPerformDropSingle(payload.Primary);

        return TryPerformMultiBlockReorder(payload);
    }

    private bool TryPerformMultiBlockReorder(BlockViewModel.BlockReorderDragPayload payload)
    {
        if (_currentDropInsertIndex < 0 || _currentDropInsertIndex > _host.Blocks.Count)
            return false;

        var move = payload.BlocksInDocumentOrder.ToList();
        if (move.Count < 2)
            return false;

        var indices = new List<int>();
        foreach (var b in move)
        {
            int i = _host.Blocks.IndexOf(b);
            if (i < 0)
                return false;
            indices.Add(i);
        }

        indices.Sort();
        if (indices.Distinct().Count() != indices.Count)
            return false;

        int insertGapOriginal = _currentDropInsertIndex;

        // Important: snapshot before reordering so undo restores original block positions.
        _host.BeginStructuralChange();
        foreach (var idx in indices.OrderByDescending(i => i))
        {
            var vm = _host.Blocks[idx];
            _host.UnsubscribeFromBlock(vm, registerReleasedStoredImagePath: false);
            _host.Blocks.RemoveAt(idx);
        }

        int removedBefore = indices.Count(i => i < insertGapOriginal);
        int newInsert = insertGapOriginal - removedBefore;
        newInsert = Math.Clamp(newInsert, 0, _host.Blocks.Count);

        foreach (var vm in move)
        {
            _host.SubscribeToBlock(vm);
            _host.Blocks.Insert(newInsert++, vm);
        }

        _host.ReorderBlocks();
        _host.CommitStructuralChange("Move blocks");
        _host.NotifyBlocksChanged();
        return true;
    }

    private bool TryPerformDropSingle(BlockViewModel draggedBlock)
    {
        if (_currentDropInsertIndex < 0 || _currentDropInsertIndex > _host.Blocks.Count)
            return false;
        // Important: every reorder path below must be wrapped in a matched Begin/_host.CommitStructuralChange pair
        // so undo restores the pre-drop block order. The three cases (detach-from-column, paired-column-move,
        // simple move) each capture their own snapshot.
        var draggedIndex = _host.Blocks.IndexOf(draggedBlock);
        if (draggedIndex < 0)
        {
            if (draggedBlock.OwnerTwoColumn == null && draggedBlock.GetColumnSibling(_host.Blocks) == null)
                return false;
            _host.BeginStructuralChange();
            var splitAfterDetach = DetachColumnCell(draggedBlock);
            var insertT = Math.Clamp(_currentDropInsertIndex, 0, _host.Blocks.Count);
            _host.SubscribeToBlock(draggedBlock);
            _host.Blocks.Insert(insertT, draggedBlock);
            _host.ReorderBlocks();
            _host.TryCollapseSplitAfterDragOut(splitAfterDetach);
            _host.CommitStructuralChange("Move block");
            _host.NotifyBlocksChanged();
            return true;
        }

        // Side-by-side pair: _host.Blocks.Move does not unpair / adjust meta; detach then insert at target gap.
        if (draggedBlock.GetColumnSibling(_host.Blocks) != null)
        {
            var rawInsert = _currentDropInsertIndex;
            if (rawInsert < 0 || rawInsert > _host.Blocks.Count)
                return false;
            if (rawInsert == draggedIndex)
                return false;
            if (rawInsert == draggedIndex + 1)
            {
                var sib = draggedBlock.GetColumnSibling(_host.Blocks);
                var sibIdx = sib != null ? _host.Blocks.IndexOf(sib) : -1;
                if (sibIdx == draggedIndex + 1)
                    return false;
            }

            _host.BeginStructuralChange();
            var splitAfterDetach = DetachColumnCell(draggedBlock);
            var insertAt = draggedIndex < rawInsert ? rawInsert - 1 : rawInsert;
            insertAt = Math.Clamp(insertAt, 0, _host.Blocks.Count);
            _host.SubscribeToBlock(draggedBlock);
            _host.Blocks.Insert(insertAt, draggedBlock);
            _host.ReorderBlocks();
            _host.TryCollapseSplitAfterDragOut(splitAfterDetach);
            _host.CommitStructuralChange("Move block");
            _host.NotifyBlocksChanged();
            return true;
        }

        var insertIndex = Math.Min(_currentDropInsertIndex, _host.Blocks.Count - 1);
        var targetIndex = draggedIndex < insertIndex ? insertIndex - 1 : insertIndex;

        if (draggedIndex == targetIndex) return false;

        _host.BeginStructuralChange();
        _host.Blocks.Move(draggedIndex, targetIndex);
        for (int i = 0; i < _host.Blocks.Count; i++)
            _host.Blocks[i].Order = i;
        _host.CommitStructuralChange("Move block");
        _host.NotifyBlocksChanged();
        return true;
    }

    private bool TryUpdateSplitDropIndicator(Point cursorPosInEditor, BlockViewModel draggedBlock)
    {
        if (!TryGetSplitDropTarget(cursorPosInEditor, draggedBlock, out var target, out var leftEdge))
            return false;

        if (ReferenceEquals(_splitDropTargetBlock, target) && _splitDropLeftEdge == leftEdge && _currentDropIndicatorBlock != null)
            return true;

        ClearDropIndicator();
        _splitDropTargetBlock = target;
        _splitDropLeftEdge = leftEdge;
        _currentDropInsertIndex = -1;

        var blockVisual = GetEditableBlockForViewModel(target!);
        if (blockVisual == null) return true;
        _currentDropIndicatorBlock = blockVisual;
        if (leftEdge)
            blockVisual.ShowDropLineAtLeft();
        else
            blockVisual.ShowDropLineAtRight();
        return true;
    }

    private bool TryUpdateColumnDropIndicator(Point cursorPosInEditor, BlockViewModel draggedBlock)
    {
        if (!TryGetColumnDropInsert(cursorPosInEditor, draggedBlock, out var tc, out var left, out var insertIdx))
            return false;

        var col = left ? tc.LeftColumnBlocks : tc.RightColumnBlocks;
        var from = col.IndexOf(draggedBlock);
        if (from >= 0 && (insertIdx == from || insertIdx == from + 1))
            return false;

        if (ReferenceEquals(_columnDropTarget, tc) && _columnDropLeft == left && _columnDropInsertIndex == insertIdx
            && _host.FindControl<Border>("BlockReorderDropLineOverlay") is { IsVisible: true })
            return true;

        ClearDropIndicator();
        _columnDropTarget = tc;
        _columnDropLeft = left;
        _columnDropInsertIndex = insertIdx;
        _currentDropInsertIndex = -1;
        ShowColumnDropLineInOverlay(tc, left, insertIdx);
        return true;
    }

    internal bool TryGetColumnDropInsert(Point cursor, BlockViewModel dragged, out TwoColumnBlockViewModel tc,
        out bool leftColumn, out int insertIndex)
    {
        tc = null!;
        leftColumn = false;
        insertIndex = 0;
        if (dragged is TwoColumnBlockViewModel || dragged.Type == BlockType.Divider)
            return false;

        for (int r = 0; r < _host.BlockRows.Count; r++)
        {
            if (_host.BlockRows[r] is not SplitBlockRowViewModel sp) continue;
            var rowHost = TryGetRealizedRowContainer(r);
            if (rowHost == null) continue; // virtualized out
            tc = sp.TwoColumn;
            var splitView = rowHost.GetVisualDescendants().OfType<SplitBlockRowView>().FirstOrDefault();
            if (splitView == null) continue;
            // Use full column grid cells (RootGrid columns 0 / 2), not ItemsControl bounds; when one column
            // is shorter than the other, empty vertical space below the shorter stack still belongs to that column.
            var rootGrid = splitView.FindControl<Grid>("RootGrid");
            if (rootGrid == null) continue;
            Control? leftColHost = null;
            Control? rightColHost = null;
            foreach (var ch in rootGrid.Children)
            {
                if (ch is not Control c) continue;
                var col = Grid.GetColumn(c);
                if (col == 0) leftColHost = c;
                else if (col == 2) rightColHost = c;
            }

            if (leftColHost == null || rightColHost == null) continue;
            var lTl = leftColHost.TranslatePoint(new Point(0, 0), _host);
            var rTl = rightColHost.TranslatePoint(new Point(0, 0), _host);
            if (!lTl.HasValue || !rTl.HasValue) continue;
            var leftRect = new Rect(lTl.Value, leftColHost.Bounds.Size);
            var rightRect = new Rect(rTl.Value, rightColHost.Bounds.Size);
            if (leftRect.Contains(cursor))
            {
                leftColumn = true;
                return TryInsertIndexInColumnStack(cursor.Y, tc.LeftColumnBlocks, out insertIndex);
            }
            if (rightRect.Contains(cursor))
            {
                leftColumn = false;
                return TryInsertIndexInColumnStack(cursor.Y, tc.RightColumnBlocks, out insertIndex);
            }
        }
        return false;
    }

    private bool TryInsertIndexInColumnStack(double cursorY, ObservableCollection<BlockViewModel> col,
        out int insertIndex)
    {
        insertIndex = 0;
        if (col.Count == 0)
        {
            insertIndex = 0;
            return true;
        }
        for (int i = 0; i < col.Count; i++)
        {
            var eb = GetEditableBlockForViewModel(col[i]);
            if (eb == null) continue;
            var b = GetControlBoundsInEditor(eb);
            if (b.Height <= 0) continue;
            double midY = b.Y + b.Height * 0.5;
            if (cursorY < midY)
            {
                insertIndex = i;
                return true;
            }
        }
        insertIndex = col.Count;
        return true;
    }

    private SplitBlockRowView? FindSplitRowView(TwoColumnBlockViewModel tc)
    {
        if (_host.BlocksItemsControl == null) return null;
        for (int r = 0; r < _host.BlockRows.Count; r++)
        {
            if (_host.BlockRows[r] is not SplitBlockRowViewModel sp || !ReferenceEquals(sp.TwoColumn, tc))
                continue;
            var rowHost = TryGetRealizedRowContainer(r);
            return rowHost?.GetVisualDescendants().OfType<SplitBlockRowView>().FirstOrDefault();
        }
        return null;
    }

    internal void ShowColumnDropLineInOverlay(TwoColumnBlockViewModel tc, bool leftColumn, int insertIndex)
    {
        var overlay = _host.FindControl<LayoutOverlayPanel>("BlockDragGhostOverlay");
        var line = _host.FindControl<Border>("BlockReorderDropLineOverlay");
        if (overlay == null || line == null) return;

        var col = leftColumn ? tc.LeftColumnBlocks : tc.RightColumnBlocks;
        double x, y, width;

        if (col.Count == 0)
        {
            var splitView = FindSplitRowView(tc);
            var ic = splitView?.FindControl<ItemsRepeater>(leftColumn ? "LeftColumnItems" : "RightColumnItems");
            if (ic == null) return;
            var tl = ic.TranslatePoint(new Point(0, 0), overlay);
            if (!tl.HasValue) return;
            x = tl.Value.X;
            y = tl.Value.Y;
            width = ic.Bounds.Width;
        }
        else if (insertIndex < col.Count)
        {
            var eb = GetEditableBlockForViewModel(col[insertIndex]);
            if (eb == null) return;
            var tl = eb.TranslatePoint(new Point(0, 0), overlay);
            if (!tl.HasValue) return;
            y = tl.Value.Y - 2;
            x = tl.Value.X;
            width = eb.Bounds.Width;
        }
        else
        {
            var eb = GetEditableBlockForViewModel(col[^1]);
            if (eb == null) return;
            var tl = eb.TranslatePoint(new Point(0, eb.Bounds.Height), overlay);
            if (!tl.HasValue) return;
            y = tl.Value.Y - HorizontalDropLineHeight * 0.5;
            var tl0 = eb.TranslatePoint(new Point(0, 0), overlay);
            if (!tl0.HasValue) return;
            x = tl0.Value.X;
            width = eb.Bounds.Width;
        }

        line.Width = width;
        line.Height = HorizontalDropLineHeight;
        Canvas.SetLeft(line, x);
        Canvas.SetTop(line, y);
        line.IsVisible = true;
        overlay.InvalidateArrange();
    }

    private bool TryPerformColumnDrop(BlockViewModel dragged, TwoColumnBlockViewModel tc, bool leftColumn, int insertIndex)
    {
        if (dragged is TwoColumnBlockViewModel || dragged.Type == BlockType.Divider)
            return false;
        var col = leftColumn ? tc.LeftColumnBlocks : tc.RightColumnBlocks;

        int fromIdx = col.IndexOf(dragged);
        bool sameList = fromIdx >= 0;
        if (sameList && (insertIndex == fromIdx || insertIndex == fromIdx + 1))
            return false;

        _host.BeginStructuralChange();

        if (sameList)
        {
            col.RemoveAt(fromIdx);
            BlockHierarchy.ClearChildOwnership(dragged);
            int adj = insertIndex;
            if (fromIdx < insertIndex) adj--;
            adj = Math.Clamp(adj, 0, col.Count);
            BlockHierarchy.WireChildOwnership(tc, dragged, leftColumn);
            col.Insert(adj, dragged);
        }
        else
        {
            TwoColumnBlockViewModel? detachedFrom = null;
            if (dragged.OwnerTwoColumn != null)
                detachedFrom = DetachColumnCell(dragged);
            else if (dragged.GetColumnSibling(_host.Blocks) != null)
                detachedFrom = DetachColumnCell(dragged);
            else
            {
                var ti = _host.Blocks.IndexOf(dragged);
                if (ti >= 0)
                {
                    _host.UnsubscribeFromBlock(dragged, registerReleasedStoredImagePath: false);
                    _host.Blocks.RemoveAt(ti);
                }
            }

            BlockHierarchy.WireChildOwnership(tc, dragged, leftColumn);
            insertIndex = Math.Clamp(insertIndex, 0, col.Count);
            _host.SubscribeToBlock(dragged);
            col.Insert(insertIndex, dragged);
            _host.TryCollapseSplitAfterDragOut(detachedFrom);
        }

        _host.ReorderBlocks();
        _host.CommitStructuralChange("Move to column");
        _host.NotifyBlocksChanged();
        return true;
    }

    /// <summary>Horizontal strip width (each side) for split-into-columns; only active near editor content edges.</summary>
    private static double GetSplitDropSideBandWidth(double contentWidth)
    {
        if (contentWidth <= 0) return 0;
        // ~10% of content, clamped; keeps most width for vertical reorder only.
        double band = contentWidth * 0.10;
        band = Math.Clamp(band, 52, 96);
        double maxHalf = Math.Max(0, (contentWidth - 24) * 0.5);
        return maxHalf > 0 ? Math.Min(band, maxHalf) : band;
    }

    private bool TryGetEditorBlocksContentXRange(out double left, out double right)
    {
        left = 0;
        right = 0;
        if (_host.BlocksItemsControl == null) return false;
        var tl = _host.BlocksItemsControl.TranslatePoint(new Point(0, 0), _host);
        if (!tl.HasValue) return false;
        double w = _host.BlocksItemsControl.Bounds.Width;
        if (w <= 0) return false;
        left = tl.Value.X;
        right = tl.Value.X + w;
        return true;
    }

    /// <returns>True if cursor is in a side band; <paramref name="leftEdge"/> = split with dragged as left column when in the left band.</returns>
    private bool TryGetSplitIntentFromEditorX(double cursorX, out bool leftEdge)
    {
        leftEdge = false;
        if (!TryGetEditorBlocksContentXRange(out var contentLeft, out var contentRight))
            return false;
        double contentW = contentRight - contentLeft;
        double band = GetSplitDropSideBandWidth(contentW);
        if (band <= 0) return false;
        if (cursorX < contentLeft + band)
        {
            leftEdge = true;
            return true;
        }
        if (cursorX > contentRight - band)
        {
            leftEdge = false;
            return true;
        }
        return false;
    }

    private bool TryGetSplitDropTarget(Point cursor, BlockViewModel dragged, out BlockViewModel? target, out bool leftEdge)
    {
        target = null;
        leftEdge = false;
        if (dragged.Type == BlockType.Divider)
            return false;
        if (!TryGetSplitIntentFromEditorX(cursor.X, out leftEdge))
            return false;

        var boundsList = GetRealizedRowGeometryInEditorOrder();
        if (boundsList.Count == 0) return false;

        for (int i = 0; i < boundsList.Count; i++)
        {
            var (r, _, top, bottom) = boundsList[i];
            if (cursor.Y < top || cursor.Y >= bottom) continue;

            var row = _host.BlockRows[r];
            if (row is SplitBlockRowViewModel splitRow)
            {
                BlockViewModel? hit = null;
                foreach (var vm in BlockHierarchy.EnumerateInDocumentOrder(new[] { splitRow.TwoColumn }))
                {
                    if (ReferenceEquals(vm, dragged) || vm.Type == BlockType.Divider) continue;
                    var rect = GetEditableBlockBoundsInEditor(GetEditableBlockForViewModel(vm));
                    if (rect.Width <= 0) continue;
                    if (cursor.Y < rect.Y || cursor.Y >= rect.Bottom) continue;
                    if (cursor.X >= rect.X && cursor.X < rect.Right)
                    {
                        hit = vm;
                        break;
                    }
                }
                if (hit == null)
                {
                    double best = double.MaxValue;
                    foreach (var vm in BlockHierarchy.EnumerateInDocumentOrder(new[] { splitRow.TwoColumn }))
                    {
                        if (ReferenceEquals(vm, dragged) || vm.Type == BlockType.Divider) continue;
                        var rect = GetEditableBlockBoundsInEditor(GetEditableBlockForViewModel(vm));
                        if (rect.Width <= 0) continue;
                        if (cursor.Y < rect.Y || cursor.Y >= rect.Bottom) continue;
                        double cx = rect.X + rect.Width * 0.5;
                        double d = Math.Abs(cursor.X - cx);
                        if (d < best)
                        {
                            best = d;
                            hit = vm;
                        }
                    }
                }
                if (hit == null) return false;
                target = hit;
                return true;
            }

            if (row is SingleBlockRowViewModel single)
            {
                var vm = single.Block;
                if (ReferenceEquals(vm, dragged) || vm.Type == BlockType.Divider) return false;

                var rect = GetEditableBlockBoundsInEditor(GetEditableBlockForViewModel(vm));
                if (rect.Width <= 0) return false;

                target = vm;
                return true;
            }

            return false;
        }

        return false;
    }

    /// <summary>Remove <paramref name="cell"/> from a split column or legacy flat pair.</summary>
    /// <returns>The <see cref="TwoColumnBlockViewModel"/> when detached from a nested split (caller should run collapse after drop completes).</returns>
    private TwoColumnBlockViewModel? DetachColumnCell(BlockViewModel cell)
    {
        if (cell.OwnerTwoColumn is TwoColumnBlockViewModel tc)
        {
            var col = cell.IsLeftColumn ? tc.LeftColumnBlocks : tc.RightColumnBlocks;
            _host.UnsubscribeFromBlock(cell, registerReleasedStoredImagePath: false);
            col.Remove(cell);
            BlockHierarchy.ClearChildOwnership(cell);
            if (col.Count == 0)
            {
                var ph = BlockFactory.CreateBlock(BlockType.Text, 0);
                BlockHierarchy.WireChildOwnership(tc, ph, cell.IsLeftColumn);
                col.Add(ph);
                _host.SubscribeToBlock(ph);
            }
            return tc;
        }

        var sibling = cell.GetColumnSibling(_host.Blocks);
        if (sibling == null) return null;
        _host.UnsubscribeFromBlock(cell, registerReleasedStoredImagePath: false);
        var idx = _host.Blocks.IndexOf(cell);
        if (idx < 0) return null;
        _host.Blocks.RemoveAt(idx);
        ColumnPairHelper.ClearPair(cell, sibling);
        return null;
    }

    private bool TryPerformSplitDrop(BlockViewModel dragged, BlockViewModel target, bool dropOnLeftEdge)
    {
        if (dragged.Type == BlockType.Divider || target.Type == BlockType.Divider)
            return false;
        // Only split top-level targets into a new row (multi-block columns need different UX).
        if (target.OwnerTwoColumn != null)
            return false;

        var targetIdx = _host.Blocks.IndexOf(target);
        if (targetIdx < 0) return false;

        _host.BeginStructuralChange();

        TwoColumnBlockViewModel? splitLeftBehind = null;
        if (dragged.OwnerTwoColumn != null || dragged.GetColumnSibling(_host.Blocks) != null)
            splitLeftBehind = DetachColumnCell(dragged);

        targetIdx = _host.Blocks.IndexOf(target);
        if (targetIdx < 0) return false;

        var targetSib = target.GetColumnSibling(_host.Blocks);
        if (targetSib != null)
        {
            var tIdxBefore = _host.Blocks.IndexOf(target);
            var sIdx = _host.Blocks.IndexOf(targetSib);
            _host.UnsubscribeFromBlock(targetSib, registerReleasedStoredImagePath: false);
            _host.Blocks.RemoveAt(sIdx);
            ColumnPairHelper.ClearPair(target, targetSib);
            _host.SubscribeToBlock(targetSib);
            var newTIdx = _host.Blocks.IndexOf(target);
            if (sIdx < tIdxBefore)
                _host.Blocks.Insert(newTIdx, targetSib);
            else
                _host.Blocks.Insert(newTIdx + 1, targetSib);
            targetIdx = _host.Blocks.IndexOf(target);
        }

        var draggedIdx = _host.Blocks.IndexOf(dragged);
        if (draggedIdx >= 0)
        {
            _host.UnsubscribeFromBlock(dragged, registerReleasedStoredImagePath: false);
            _host.Blocks.RemoveAt(draggedIdx);
            if (draggedIdx < targetIdx) targetIdx--;
        }

        _host.UnsubscribeFromBlock(target, registerReleasedStoredImagePath: false);
        _host.Blocks.RemoveAt(targetIdx);

        var left = dropOnLeftEdge ? dragged : target;
        var right = dropOnLeftEdge ? target : dragged;

        var tc = new TwoColumnBlockViewModel(left.Order);
        BlockHierarchy.WireChildOwnership(tc, left, true);
        BlockHierarchy.WireChildOwnership(tc, right, false);
        tc.LeftColumnBlocks.Add(left);
        tc.RightColumnBlocks.Add(right);
        _host.SubscribeToBlock(tc);
        _host.Blocks.Insert(targetIdx, tc);

        _host.ReorderBlocks();
        _host.TryCollapseSplitAfterDragOut(splitLeftBehind);
        _host.CommitStructuralChange("Split into columns");
        _host.NotifyBlocksChanged();

        Dispatcher.UIThread.Post(() => left.IsFocused = true, DispatcherPriority.Input);
        return true;
    }

    internal int GetInsertIndex(double cursorY)
    {
        var rowBounds = GetRealizedRowGeometryInEditorOrder();
        if (rowBounds.Count == 0)
            return -1;

        for (int i = 0; i < rowBounds.Count; i++)
        {
            var (r, _, top, bottom) = rowBounds[i];
            if (cursorY < top || cursorY >= bottom) continue;

            var row = _host.BlockRows[r];
            int insertBeforeTop = row.StartBlockIndex;
            int insertAfterBottom = row.StartBlockIndex + row.BlockSpan;

            var height = bottom - top;
            var snapBand = Math.Max(4, height * SnapBandFraction);

            if (cursorY < top + snapBand)
                return insertBeforeTop;

            if (cursorY >= bottom - snapBand)
                return insertAfterBottom;

            if (_currentDropInsertIndex == insertBeforeTop || _currentDropInsertIndex == insertAfterBottom)
                return _currentDropInsertIndex;

            var midY = (top + bottom) / 2.0;
            return cursorY < midY ? insertBeforeTop : insertAfterBottom;
        }

        // Cursor was past every realized row's vertical range. With virtualization rows beyond
        // the viewport aren't realized; falling through to _host.Blocks.Count is correct for both the
        // "cursor below the last block" case and the "cursor past a virtualized region" case.
        return _host.Blocks.Count;
    }

    /// <summary>
    /// When dragging a block out of a split, prefer full-width horizontal gaps above/below the split row
    /// (snap bands) over in-column drop targets.
    /// </summary>
    private bool TryGetTopLevelInsertInSplitRowSnapBand(double cursorY, TwoColumnBlockViewModel tc, out int insertIndex)
    {
        insertIndex = -1;
        if (_host.Blocks.IndexOf(tc) < 0) return false;

        var rowBounds = GetRealizedRowGeometryInEditorOrder();
        if (rowBounds.Count == 0)
            return false;

        for (int i = 0; i < rowBounds.Count; i++)
        {
            var (r, _, top, bottom) = rowBounds[i];
            if (_host.BlockRows[r] is not SplitBlockRowViewModel sp || !ReferenceEquals(sp.TwoColumn, tc))
                continue;

            if (cursorY < top || cursorY >= bottom)
                continue;

            var row = _host.BlockRows[r];
            int insertBeforeTop = row.StartBlockIndex;
            int insertAfterBottom = row.StartBlockIndex + row.BlockSpan;
            var height = bottom - top;
            var snapBand = Math.Max(4, height * SnapBandFraction);

            if (cursorY < top + snapBand)
            {
                insertIndex = insertBeforeTop;
                return true;
            }
            if (cursorY >= bottom - snapBand)
            {
                insertIndex = insertAfterBottom;
                return true;
            }
            return false;
        }
        return false;
    }

    /// <summary>
    /// Row-index-aware enumeration of realized item containers. With UI virtualization the
    /// realized set is a subset of <see cref="_host.BlockRows"/>; previously the helpers assumed
    /// 1:1 with row indices, which breaks once <see cref="_host.BlocksItemsControl"/> virtualizes.
    /// </summary>
    private List<(int RowIndex, Control Container, double Top, double Bottom)> GetRealizedRowGeometryInEditorOrder()
    {
        var list = new List<(int, Control, double, double)>();
        if (_host.BlocksItemsControl == null) return list;

        for (int i = 0; i < _host.BlockRows.Count; i++)
        {
            if (_host.BlocksItemsControl.TryGetElement(i) is not Control container) continue;
            var topLeft = container.TranslatePoint(new Point(0, 0), _host);
            if (!topLeft.HasValue) continue;
            var h = container.Bounds.Height;
            if (double.IsNaN(h) || h <= 0) continue;
            list.Add((i, container, topLeft.Value.Y, topLeft.Value.Y + h));
        }
        return list;
    }

    /// <summary>
    /// Returns the realized container for <paramref name="rowIndex"/> or null when virtualized out.
    /// Cheap (O(1)); uses <see cref="ItemsRepeater.TryGetElement(int)"/>.
    /// </summary>
    private Control? TryGetRealizedRowContainer(int rowIndex)
    {
        if (_host.BlocksItemsControl == null) return null;
        if (rowIndex < 0 || rowIndex >= _host.BlockRows.Count) return null;
        return _host.BlocksItemsControl.TryGetElement(rowIndex) as Control;
    }

    private List<Control>? GetBlockContainersInOrder()
    {
        if (_host.BlocksItemsControl == null) return null;

        // ItemsRepeater realizes only rows in the viewport; iterate row indices and pick up the
        // realized ones in order. Returns null when nothing has been realized yet (e.g. first
        // frame before measure).
        var list = new List<Control>(Math.Min(_host.BlockRows.Count, 64));
        for (int i = 0; i < _host.BlockRows.Count; i++)
        {
            if (_host.BlocksItemsControl.TryGetElement(i) is Control c)
                list.Add(c);
        }
        return list.Count > 0 ? list : null;
    }

    internal EditableBlock? GetEditableBlockForViewModel(BlockViewModel? vm)
    {
        if (vm == null) return null;

        // O(1) hot path; populated by EditableBlock.OnControlLoaded/Unloaded. Hot callers
        // (ClearTextSelectionInAllBlocksExcept, find/replace, cross-block selection) used to
        // walk the entire visual tree per block; with 1500 _host.Blocks that was O(NÃ‚Â²).
        if (_host._realizedBlocksByVm.TryGetValue(vm, out var cached))
        {
            // Container can survive in the dict for one tick after detach; verify DataContext.
            if (ReferenceEquals(cached.DataContext, vm))
                return cached;
            _host._realizedBlocksByVm.Remove(vm);
        }

        // Fallback (first-frame / nested column cells before Loaded fires): search only realized
        // row roots (sparse list preserves document order among realized rows; index is NOT row id).
        var containers = GetBlockContainersInOrder();
        if (containers == null) return null;
        for (var i = 0; i < containers.Count; i++)
        {
            var c = containers[i];
            var eb = c.GetVisualDescendants().OfType<EditableBlock>()
                .FirstOrDefault(e => ReferenceEquals(e.DataContext, vm));
            if (eb != null)
            {
                _host._realizedBlocksByVm[vm] = eb;
                return eb;
            }
        }
        return null;
    }

    internal Rect GetEditableBlockBoundsInEditor(EditableBlock? eb) => GetControlBoundsInEditor(eb);

    internal Rect GetControlBoundsInEditor(Control? c)
    {
        if (c == null) return default;
        var tl = c.TranslatePoint(new Point(0, 0), _host);
        if (!tl.HasValue) return default;
        return new Rect(tl.Value, c.Bounds.Size);
    }

    /// <summary>Items row container for the row where horizontal insert <paramref name="insertIndex"/> applies, or null when virtualized out.</summary>
    private Control? GetRowContainerForInsertIndex(int insertIndex)
    {
        if (_host.BlocksItemsControl == null || _host.BlockRows.Count == 0) return null;

        if (insertIndex >= _host.Blocks.Count)
        {
            // Tail anchor: walk back to the highest realized row.
            for (int r = _host.BlockRows.Count - 1; r >= 0; r--)
            {
                if (_host.BlocksItemsControl.TryGetElement(r) is Control tail) return tail;
            }
            return null;
        }

        for (int r = 0; r < _host.BlockRows.Count; r++)
        {
            var row = _host.BlockRows[r];
            if (insertIndex >= row.StartBlockIndex && insertIndex < row.StartBlockIndex + row.BlockSpan)
                return _host.BlocksItemsControl.TryGetElement(r) as Control;
        }
        return null;
    }

    
}

