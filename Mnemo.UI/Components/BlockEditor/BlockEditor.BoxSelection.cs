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
    #region Drag-box block selection (Mode 2)

    /// <summary>
    /// Clears block selection (IsSelected) on all blocks. Call when the user performs
    /// another action (focus a block, edit text, drag to reorder, etc.).
    /// </summary>
    public void ClearBlockSelection()
    {
        if (_selectedBlockCount > 0)
        {
            foreach (var block in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
            {
                if (block.IsSelected)
                    block.IsSelected = false;
            }
        }

        // Blocks removed while selected do not decrement the counter; force sync so Backspace is not swallowed.
        _selectedBlockCount = 0;
        _blockDragHandleSelectionAnchorIndex = -1;
    }

    /// <summary>Selects exactly one block (e.g. click on drag handle). Clears all text selection.</summary>
    public void SelectSingleBlock(BlockViewModel vm)
    {
        if (BlockHierarchy.FindById(Blocks, vm.Id) == null) return;
        ClearTextSelectionInAllBlocksExcept(null);
        foreach (var block in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
            block.IsSelected = ReferenceEquals(block, vm);
        _blockDragHandleSelectionAnchorIndex = GetDocumentOrderBlocks().IndexOf(vm);
    }

    /// <summary>
    /// Drag handle release (no drag): plain = single; Ctrl/Meta = toggle; Shift = range from anchor;
    /// Ctrl+Shift+range = add that range to the current selection.
    /// </summary>
    public void SelectBlockFromDragHandle(BlockViewModel vm, KeyModifiers modifiers)
    {
        if (BlockHierarchy.FindById(Blocks, vm.Id) == null) return;
        ClearTextSelectionInAllBlocksExcept(null);
        var doc = GetDocumentOrderBlocks();
        int idx = doc.IndexOf(vm);
        if (idx < 0) return;

        bool toggle = (modifiers & (KeyModifiers.Control | KeyModifiers.Meta)) != 0;
        bool shift = modifiers.HasFlag(KeyModifiers.Shift);

        if (toggle && !shift)
        {
            vm.IsSelected = !vm.IsSelected;
            _blockDragHandleSelectionAnchorIndex = idx;
            return;
        }

        if (shift)
        {
            int anchor = _blockDragHandleSelectionAnchorIndex >= 0 ? _blockDragHandleSelectionAnchorIndex : GetShiftRangeAnchorIndex(idx);
            int lo = Math.Min(anchor, idx);
            int hi = Math.Max(anchor, idx);
            if (toggle)
            {
                for (int i = lo; i <= hi; i++)
                    doc[i].IsSelected = true;
            }
            else
            {
                for (int i = 0; i < doc.Count; i++)
                    doc[i].IsSelected = i >= lo && i <= hi;
            }
            _blockDragHandleSelectionAnchorIndex = anchor;
            return;
        }

        SelectSingleBlock(vm);
    }

    private int GetShiftRangeAnchorIndex(int clickedIndex)
    {
        var doc = GetDocumentOrderBlocks();
        for (int i = 0; i < doc.Count; i++)
        {
            if (doc[i].IsFocused)
                return i;
        }
        return clickedIndex;
    }

    /// <summary>
    /// Shows a live clone of the block (same as notes sidebar ghost) at reduced opacity; avoids RenderTargetBitmap text rasterization artifacts.
    /// </summary>
    internal void BeginBlockDragGhost(EditableBlock source, PointerEventArgs e)
    {
        EndBlockDragGhost();

        var overlay = this.FindControl<LayoutOverlayPanel>("BlockDragGhostOverlay");
        if (overlay == null) return;

        double w = source.Bounds.Width;
        double h = source.Bounds.Height;
        if (w <= 0 || h <= 0)
        {
            var snap = source.BlockDragSnapshotTarget;
            w = snap.Bounds.Width;
            h = snap.Bounds.Height;
        }

        if (w <= 0 || h <= 0) return;

        var ghostBlock = new EditableBlock
        {
            DataContext = source.DataContext,
            Width = w,
            Height = h,
            Focusable = false,
            IsHitTestVisible = false,
            IsTabStop = false
        };

        var ghost = new Border
        {
            Child = ghostBlock,
            Opacity = BlockDragGhostOpacity,
            IsHitTestVisible = false,
            BoxShadow = BoxShadows.Parse("0 4 16 0 #40000000"),
            CornerRadius = new CornerRadius(4),
            Width = w,
            Height = h
        };

        var pointerInOverlay = e.GetPosition(overlay);
        var originPoint = source.TranslatePoint(new Point(0, 0), overlay) ?? new Point(0, 0);
        _blockDragGhostPointerOffset = pointerInOverlay - originPoint;

        Canvas.SetLeft(ghost, pointerInOverlay.X - _blockDragGhostPointerOffset.X);
        Canvas.SetTop(ghost, pointerInOverlay.Y - _blockDragGhostPointerOffset.Y);

        overlay.Children.Add(ghost);
        _blockDragGhostBorder = ghost;
        _blockDragGhostOverlay = overlay;
        overlay.InvalidateArrange();
    }

    /// <summary>
    /// Positions the reorder ghost using editor-space coordinates (same as <see cref="EditableBlock"/> DragOver).
    /// </summary>
    internal void UpdateBlockDragGhostFromEditorPoint(Point cursorPosInEditor)
    {
        if (_blockDragGhostBorder == null || _blockDragGhostOverlay == null) return;
        var pt = this.TranslatePoint(cursorPosInEditor, _blockDragGhostOverlay);
        if (!pt.HasValue) return;
        Canvas.SetLeft(_blockDragGhostBorder, pt.Value.X - _blockDragGhostPointerOffset.X);
        Canvas.SetTop(_blockDragGhostBorder, pt.Value.Y - _blockDragGhostPointerOffset.Y);
        _blockDragGhostOverlay.InvalidateArrange();

        MaybeAutoScrollViewportDuringBlockDrag(cursorPosInEditor);
    }

    private void MaybeAutoScrollViewportDuringBlockDrag(Point cursorPosInEditor)
    {
        var scrollViewer = this.FindAncestorOfType<ScrollViewer>();
        if (scrollViewer == null) return;

        var ptInScroll = this.TranslatePoint(cursorPosInEditor, scrollViewer);
        if (!ptInScroll.HasValue) return;

        double scrollHeight = scrollViewer.Bounds.Height;
        if (scrollHeight <= 0) return;

        double y = ptInScroll.Value.Y;

        if (y < BlockDragAutoScrollZone)
        {
            double intensity = 1.0 - (y / BlockDragAutoScrollZone);
            _blockDragAutoScrollDirection = -BlockDragAutoScrollStep * (1 + intensity);
            EnsureBlockDragAutoScrollTimer();
        }
        else if (y > scrollHeight - BlockDragAutoScrollZone)
        {
            double intensity = 1.0 - ((scrollHeight - y) / BlockDragAutoScrollZone);
            _blockDragAutoScrollDirection = BlockDragAutoScrollStep * (1 + intensity);
            EnsureBlockDragAutoScrollTimer();
        }
        else
        {
            StopBlockDragAutoScroll();
        }
    }

    private void EnsureBlockDragAutoScrollTimer()
    {
        if (_blockDragAutoScrollTimer != null) return;
        _blockDragAutoScrollTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(BlockDragAutoScrollIntervalMs) };
        _blockDragAutoScrollTimer.Tick += OnBlockDragAutoScrollTick;
        _blockDragAutoScrollTimer.Start();
    }

    private void OnBlockDragAutoScrollTick(object? sender, EventArgs e)
    {
        if (_blockDragGhostBorder == null)
        {
            StopBlockDragAutoScroll();
            return;
        }

        var scrollViewer = this.FindAncestorOfType<ScrollViewer>();
        if (scrollViewer == null)
        {
            StopBlockDragAutoScroll();
            return;
        }

        var current = scrollViewer.Offset;
        double maxY = Math.Max(0, scrollViewer.Extent.Height - scrollViewer.Viewport.Height);
        double newY = Math.Clamp(current.Y + _blockDragAutoScrollDirection, 0, maxY);
        scrollViewer.Offset = new Vector(current.X, newY);
    }

    private void StopBlockDragAutoScroll()
    {
        if (_blockDragAutoScrollTimer != null)
        {
            _blockDragAutoScrollTimer.Tick -= OnBlockDragAutoScrollTick;
            _blockDragAutoScrollTimer.Stop();
            _blockDragAutoScrollTimer = null;
        }
        _blockDragAutoScrollDirection = 0;
    }

    internal void EndBlockDragGhost()
    {
        StopBlockDragAutoScroll();

        if (_blockDragGhostBorder != null && _blockDragGhostOverlay != null)
        {
            _blockDragGhostOverlay.Children.Remove(_blockDragGhostBorder);
            _blockDragGhostOverlay.InvalidateArrange();
        }

        _blockDragGhostBorder = null;
        _blockDragGhostOverlay = null;
    }

    /// <summary>
    /// Arms box-select from an external control (e.g. the ScrollViewer gutter outside the editor column).
    /// <paramref name="pressPointInEditor"/> must already be in editor coordinates.
    /// Returns true if armed (caller should capture the pointer on its own control and forward
    /// subsequent PointerMoved/Released via <see cref="HandleExternalPointerMoved"/> and
    /// <see cref="HandleExternalPointerReleased"/>).
    /// </summary>
    public bool ArmExternalBoxSelect(Point pressPointInEditor, IPointer pointer)
    {
        _boxSelectStart = pressPointInEditor;
        var overlay = _selectionBoxBorder?.GetVisualParent() as Visual;
        _boxSelectStartInOverlay = overlay != null && this.TranslatePoint(pressPointInEditor, overlay) is { } ov ? ov : pressPointInEditor;
        _boxSelectArmed = true;
        _isBoxSelecting = false;
        ClearBlockSelection();
        ClearTextSelectionInAllBlocksExcept(null);
        pointer.Capture(this);
        return true;
    }

    /// <summary>
    /// Tunnel: when press is inside a block, capture immediately for cross-block text selection so we receive
    /// PointerMoved (TextBox would otherwise capture and we would never see moves). When press is on empty
    /// space, arm box-select and capture in PointerMoved once threshold is exceeded.
    /// </summary>
    private void Editor_PointerPressedTunnel(object? sender, PointerPressedEventArgs e)
    {
        if (IsReadOnly)
            return;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;

        // Double/triple clicks: clear all blocks so only the block under the tap will get word/line selection from TextBox.
        if (e.ClickCount > 1)
        {
            var pt = e.GetPosition(this);
            if (IsPointInsideAnyBlock(pt))
            {
                ClearBlockSelection();
                ClearTextSelectionInAllBlocksExcept(null);
            }
            return;
        }

        // If the press originated on the drag handle, let it propagate so DoDragDrop can run.
        var source = e.Source as Visual;
        bool hitIsDragHandle = source != null &&
            (source is Border { Tag: "DragHandle" } ||
             source.GetVisualAncestors().OfType<Border>().Any(b => b.Tag is "DragHandle"));
        if (hitIsDragHandle) return;

        // Insert-below gutter: must not capture pointer or Tapped/click never reaches the border.
        bool hitIsAddBlockBelow = source != null &&
            (source is Border { Tag: "AddBlockBelow" } ||
             source.GetVisualAncestors().OfType<Border>().Any(b => b.Tag is "AddBlockBelow"));
        if (hitIsAddBlockBelow) return;

        // Image/sketch width resize strip; must not capture here or the first drag is eaten by cross-block selection.
        bool hitIsBlockWidthResizeHandle = source != null &&
            (source is Border { Tag: "ImageResizeHandle" or "SketchResizeHandle" } ||
             source.GetVisualAncestors().OfType<Border>().Any(b => b.Tag is "ImageResizeHandle" or "SketchResizeHandle"));
        if (hitIsBlockWidthResizeHandle) return;

        // Column splitter sits in the gutter between cells, not inside EditableBlock hit; would otherwise arm box-select and steal capture.
        bool hitIsColumnSplitHandle = source != null &&
            (source is Border { Tag: "ColumnSplitHandle" } ||
             source.GetVisualAncestors().OfType<Border>().Any(b => Equals(b.Tag, "ColumnSplitHandle")));
        if (hitIsColumnSplitHandle) return;

        // Tap strip below column stacks (adds a block in that column); must not arm box-select.
        if (IsSplitColumnBottomTapBorder(source))
            return;

        // Let native CheckBox handling run (checklist toggles) instead of capturing in editor tunnel.
        bool hitIsCheckBox = source is CheckBox || (source != null && source.GetVisualAncestors().Any(a => a is CheckBox));
        if (hitIsCheckBox) return;

        var pos = e.GetPosition(this);

        if (IsPointInsideAnyBlock(pos))
        {
            // Press inside a block: arm cross-block selection and capture so we get PointerMoved
            var docList = GetDocumentOrderBlocks();
            var blockIndex = GetBlockIndexAtPoint(pos);
            if (blockIndex < 0 || blockIndex >= docList.Count) return;

            var vm = docList[blockIndex];
            var editableBlock = GetEditableBlockForViewModel(vm);
            if (editableBlock == null) return;

            // Image block: avoid capturing on first press so toolbar/flyouts and caption clicks work;
            // programmatic focus uses HoverHost unless PendingCaretIndex targets the caption.
            if (vm.Type == BlockType.Image && !vm.IsFocused)
            {
                ClearBlockSelection();
                ClearTextSelectionInAllBlocksExcept(null);
                if (TryFindImageCaptionRichEditor(source, out var captionRte))
                {
                    var idx = captionRte.HitTestPoint(e.GetPosition(captionRte));
                    vm.PendingCaretIndex = Math.Clamp(idx, 0, captionRte.TextLength);
                }
                vm.IsFocused = true;
                return;
            }

            // Sketch/Page blocks: never capture on press - Sketch uses its own drag gesture;
            // Page blocks need the Button's Click to fire on the same press (otherwise the
            // user has to click once to focus and again to open the linked note).
            if (vm.Type is BlockType.Sketch or BlockType.Page)
            {
                if (!vm.IsFocused)
                {
                    ClearBlockSelection();
                    ClearTextSelectionInAllBlocksExcept(null);
                    vm.IsFocused = true;
                }
                return;
            }

            // If this block already has focus, let the event reach RichTextEditor so it can set
            // the caret from the click (HitTestPoint). Otherwise we'd set Handled and the caret would never move.
            if (vm.IsFocused)
            {
                ClearTextSelectionInAllBlocksExcept(null);
                ClearBlockSelection();

                // If the press landed outside the RichTextEditor itself (e.g. in block padding),
                // the editor won't receive OnPointerPressed. Initiate drag-select manually so the
                // full block width acts as a hit target for starting text selection.
                // Image/sketch blocks: clicks on chrome/toolbar/resize are not text "padding".
                if (vm.Type is not BlockType.Image and not BlockType.Sketch)
                {
                    var richEditor = editableBlock.TryGetRichTextEditor();
                    if (richEditor != null)
                    {
                        // Bounds-based checks are not enough: in right-side whitespace the pointer can be inside
                        // the editor rectangle but hit-test a parent (Border/Grid), so RichTextEditor never gets
                        // OnPointerPressed. Use the actual event source ancestry instead.
                        bool sourceInsideEditor = source != null
                            && (ReferenceEquals(source, richEditor)
                                || source.GetVisualAncestors().Any(a => ReferenceEquals(a, richEditor)));
                        if (!sourceInsideEditor)
                        {
                            var pointInFocusedBlock = this.TranslatePoint(pos, editableBlock);
                            if (pointInFocusedBlock.HasValue)
                            {
                                var paddingCharIndex = editableBlock.GetCharacterIndexFromPoint(pointInFocusedBlock.Value);
                                if (paddingCharIndex < 0)
                                    paddingCharIndex = richEditor.CaretIndex;
                                paddingCharIndex = Math.Clamp(paddingCharIndex, 0, editableBlock.GetAnchorCharClampMax());
                                richEditor.StartDragSelect(paddingCharIndex, e.Pointer);
                                _crossBlockAnchorBlock = vm;
                                _crossBlockAnchorBlockIndex = blockIndex;
                                _crossBlockAnchorCharIndex = paddingCharIndex;
                                _crossBlockStartPoint = pos;
                                _crossBlockArmed = true;
                                _isCrossBlockSelecting = false;
                                e.Handled = true;
                            }
                        }
                    }
                }
                return;
            }

            var pointInBlock = this.TranslatePoint(pos, editableBlock);
            if (!pointInBlock.HasValue) return;

            var charIndex = editableBlock.GetCharacterIndexFromPoint(pointInBlock.Value);
            // Hit-test can fail while the row is freshly realized (component wiring is posted) or
            // layout is in flight. Land at the end of the block instead of snapping the caret to 0.
            if (charIndex < 0)
                charIndex = editableBlock.GetAnchorCharClampMax();

            ClearBlockSelection();
            _crossBlockAnchorBlock = vm;
            _crossBlockAnchorBlockIndex = blockIndex;
            _crossBlockAnchorCharIndex = Math.Clamp(charIndex, 0, editableBlock.GetAnchorCharClampMax());
            _crossBlockArmed = true;
            _isCrossBlockSelecting = false;

            // Clear all blocks first so the other block's selection always breaks; then set this block's caret.
            ClearTextSelectionInAllBlocksExcept(null);
            editableBlock.ApplyTextSelection(_crossBlockAnchorCharIndex, _crossBlockAnchorCharIndex);
            // Set PendingCaretIndex before IsFocused so FocusTextBox lands at the click position
            // directly; without this it would snap to the end first, causing a visible flicker.
            vm.PendingCaretIndex = _crossBlockAnchorCharIndex;
            vm.IsFocused = true;
            e.Pointer.Capture(this);
            e.Handled = true;
            return;
        }

        // Arm box-select; capture immediately to prevent ScrollViewer from stealing the gesture
        _boxSelectStart = pos;
        var overlay = _selectionBoxBorder?.GetVisualParent() as Visual;
        _boxSelectStartInOverlay = overlay != null ? e.GetPosition(overlay) : pos;
        _boxSelectArmed = true;
        _isBoxSelecting = false;

        ClearBlockSelection();
        ClearTextSelectionInAllBlocksExcept(null);
        e.Pointer.Capture(this);
    }

    private static bool TryFindImageCaptionRichEditor(Visual? source, [NotNullWhen(true)] out RichTextEditor? captionRte)
    {
        captionRte = null;
        if (source == null) return false;
        if (source is RichTextEditor r0 && r0.Tag is string t0 && t0 == "BlockEditorImageCaption")
        {
            captionRte = r0;
            return true;
        }

        var r1 = source.GetVisualAncestors().OfType<RichTextEditor>()
            .FirstOrDefault(x => x.Tag is string tag && tag == "BlockEditorImageCaption");
        if (r1 == null) return false;
        captionRte = r1;
        return true;
    }

    /// <summary>
    /// Returns true if the point (in editor coordinates) falls within a block's interactive hit surface
    /// (for image blocks: handle + content width, not full-row gutters beside a narrow image).
    /// </summary>
    private bool IsPointInsideAnyBlock(Point point)
    {
        foreach (var vm in BlockHierarchy.EnumerateInDocumentOrder(Blocks))
        {
            var editable = GetEditableBlockForViewModel(vm);
            if (editable == null) continue;
            var local = this.TranslatePoint(point, editable);
            if (!local.HasValue) continue;
            if (editable.IsPointerHitInsideBlock(local.Value))
                return true;
        }
        return false;
    }

    private bool IsPointInsideBlockSurface(BlockViewModel block, Point pointInEditor)
    {
        var editable = GetEditableBlockForViewModel(block);
        if (editable == null)
            return false;
        var local = this.TranslatePoint(pointInEditor, editable);
        return local.HasValue && editable.IsPointerHitInsideBlock(local.Value);
    }

    /// <summary>
    /// Returns true when a point (in editor coordinates) that was already confirmed to be outside all
    /// block content surfaces should trigger "insert block below". This covers two cases:
    /// <list type="bullet">
    ///   <item>The explicit <c>BelowBlocksArea</c> hit strip below the item repeater.</item>
    ///   <item>The dead zone inside the last block's inflated row but below its visual content, common
    ///     for Image and Sketch blocks whose row height is larger than their rendered content.</item>
    /// </list>
    /// Callers must only invoke this after confirming <c>_boxSelectArmed</c> (i.e. the click was not
    /// inside any block's content surface), so the second case cannot produce false positives.
    /// </summary>
    private bool IsClickEffectivelyBelowBlocks(Point clickPoint)
    {
        // Primary: the dedicated hit strip placed in grid row 1, below the ItemsRepeater.
        var belowArea = this.FindControl<Border>("BelowBlocksArea");
        if (belowArea != null)
        {
            var topLeft = belowArea.TranslatePoint(new Point(0, 0), this);
            if (topLeft.HasValue)
            {
                var rect = new Rect(topLeft.Value.X, topLeft.Value.Y, belowArea.Bounds.Width, belowArea.Bounds.Height);
                if (rect.Contains(clickPoint))
                    return true;
            }
        }

        // Secondary: dead zone inside the last top-level block's row (e.g. Image/Sketch with min-height
        // padding below the visual content, or a TwoColumn whose SplitBlockRowView row has trailing space).
        // _boxSelectArmed already guarantees the click is outside all block content surfaces, so
        // containment within the row container rect means it is in that dead zone.
        // We use TryGetElement on the ItemsRepeater rather than GetEditableBlockForViewModel because
        // TwoColumnBlockViewModel is never registered in _realizedBlocksByVm (only leaf VMs are).
        if (Blocks.Count == 0 || BlocksItemsControl == null) return false;
        var lastRowContainer = BlocksItemsControl.TryGetElement(BlockRows.Count - 1) as Control;
        if (lastRowContainer == null) return false;
        var lastTopLeft = lastRowContainer.TranslatePoint(new Point(0, 0), this);
        if (!lastTopLeft.HasValue) return false;
        var lastRect = new Rect(lastTopLeft.Value, lastRowContainer.Bounds.Size);
        return lastRect.Contains(clickPoint);
    }

    private static bool IsSplitColumnBottomTapBorder(Visual? source)
    {
        if (source == null) return false;
        if (source is Border b0 && b0.Tag is string t0 && t0.StartsWith("SplitColumnBottom", StringComparison.Ordinal))
            return true;
        return source.GetVisualAncestors().OfType<Border>()
            .Any(b => b.Tag is string t && t.StartsWith("SplitColumnBottom", StringComparison.Ordinal));
    }

    internal List<BlockViewModel> GetDocumentOrderBlocks()
    {
        if (!_documentOrderDirty && _cachedDocumentOrder != null)
            return _cachedDocumentOrder;
        _cachedDocumentOrder = BlockHierarchy.EnumerateInDocumentOrder(Blocks).ToList();
        _cachedDocIndexByVm = null; // rebuild on next GetDocIndexLookup call
        _documentOrderDirty = false;
        return _cachedDocumentOrder;
    }

    /// <summary>O(1) VM â†’ document-order index lookup. Built alongside <see cref="GetDocumentOrderBlocks"/>; cached until the document changes.</summary>
    private Dictionary<BlockViewModel, int> GetDocIndexLookup()
    {
        if (_cachedDocIndexByVm != null && !_documentOrderDirty)
            return _cachedDocIndexByVm;
        var doc = GetDocumentOrderBlocks(); // also clears _documentOrderDirty
        _cachedDocIndexByVm = new Dictionary<BlockViewModel, int>(doc.Count, ReferenceEqualityComparer.Instance);
        for (int i = 0; i < doc.Count; i++)
            _cachedDocIndexByVm[doc[i]] = i;
        return _cachedDocIndexByVm;
    }

    /// <summary>
    /// Bubble: clear selection; arm cross-block text selection when press is inside a TextBox.
    /// Skipped when we already armed and captured in Tunnel (cross-block).
    /// </summary>
    private void Editor_PointerPressedBubble(object? sender, PointerPressedEventArgs e)
    {
        if (IsReadOnly)
            return;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;

        if (_boxSelectArmed) return;
        // Already armed and captured in Tunnel for cross-block selection
        if (_crossBlockArmed) return;

        var source = e.Source as Visual;
        // Drag handle uses press+move threshold; selection is applied on release. Do not clear here.
        bool hitIsDragHandle = source != null &&
            (source is Border { Tag: "DragHandle" } ||
             source.GetVisualAncestors().OfType<Border>().Any(b => b.Tag is "DragHandle"));
        if (hitIsDragHandle) return;

        ClearBlockSelection();

        bool hitIsInTextBox = source is TextBox || source is RichTextEditor || (source != null && source.GetVisualAncestors().Any(a => a is TextBox || a is RichTextEditor));
        if (!hitIsInTextBox || source == null) return;

        var textBox = source as TextBox ?? source.GetVisualAncestors().OfType<TextBox>().FirstOrDefault();
        var richTextEditor = source as RichTextEditor ?? source.GetVisualAncestors().OfType<RichTextEditor>().FirstOrDefault();
        var editableBlock = source as EditableBlock ?? source.GetVisualAncestors().OfType<EditableBlock>().FirstOrDefault();
        if ((textBox == null && richTextEditor == null) || editableBlock == null || editableBlock.DataContext is not BlockViewModel vm || BlockHierarchy.FindById(Blocks, vm.Id) == null)
            return;

        // Image caption editor; arming cross-block breaks drag-select and steals PointerMoved.
        if (vm.Type == BlockType.Image
            && ((textBox?.Tag is string t1 && t1 == "BlockEditorImageCaption")
                || (richTextEditor?.Tag is string t2 && t2 == "BlockEditorImageCaption")))
            return;

        int caretIndex = textBox?.CaretIndex ?? richTextEditor?.CaretIndex ?? 0;
        int textLength = textBox?.Text?.Length ?? richTextEditor?.TextLength ?? 0;

        // Arm cross-block select; capture happens in PointerMoved once drag leaves the source block
        _crossBlockAnchorBlock = vm;
        _crossBlockAnchorBlockIndex = GetDocumentOrderBlocks().IndexOf(vm);
        _crossBlockAnchorCharIndex = Math.Clamp(caretIndex, 0, textLength);
        _crossBlockStartPoint = e.GetPosition(this);
        _crossBlockArmed = true;
        _isCrossBlockSelecting = false;
        // Do NOT capture or mark handled here; let the TextBox handle its own click normally
    }

    private void Editor_PointerMoved(object? sender, PointerEventArgs e)
    {
        if (IsReadOnly)
            return;
        if (_isColumnSplitResizing)
            return;

        if (_blockDragGhostBorder != null && _blockDragGhostOverlay != null)
        {
            var pos = e.GetPosition(_blockDragGhostOverlay);
            Canvas.SetLeft(_blockDragGhostBorder, pos.X - _blockDragGhostPointerOffset.X);
            Canvas.SetTop(_blockDragGhostBorder, pos.Y - _blockDragGhostPointerOffset.Y);
            _blockDragGhostOverlay.InvalidateArrange();
        }

        // Only process if at least one selection mode is armed or active
        if (!_boxSelectArmed && !_isBoxSelecting && !_crossBlockArmed && !_isCrossBlockSelecting)
            return;

        // Convert position from the event source to editor coordinates
        var current = e.GetPosition(this);

        // TopLevel tunnel runs for every move app-wide. When a child (RichTextEditor) owns capture we usually
        // skip editor-level selection; however, if cross-block is armed, hand off once pointer leaves the
        // anchor block so selection can continue across blocks.
        if (e.Pointer.Captured != null && !ReferenceEquals(e.Pointer.Captured, this))
        {
            // Recapture for both arming-stage (first cross-out) and active selection (defensive:
            // some other control could steal capture mid-drag). Without the second condition the
            // selection silently halts because the inner if only triggers once on first cross-out.
            bool shouldRecapture = (_crossBlockArmed || _isCrossBlockSelecting)
                && _crossBlockAnchorBlock != null
                && !IsPointInsideBlockSurface(_crossBlockAnchorBlock, current);
            if (shouldRecapture)
            {
                e.Pointer.Capture(this);
                // Do NOT reset the anchor RTE's _isDragging here. The pointer event is still
                // routing and will reach RichTextEditor.OnPointerMoved next; if _isDragging
                // were false there with the button still pressed, it would re-capture and
                // steal control back, breaking cross-block selection. RTE._isDragging is
                // safely reset in OnPointerMoved when isLeftPressed becomes false (after release).
            }
            else
                return;
        }

        // Box selection: activate once movement exceeds threshold; state transition is synchronous
        // so pointer capture and border visibility are set in the same event dispatch.
        if (_boxSelectArmed)
        {
            var dx = current.X - _boxSelectStart.X;
            var dy = current.Y - _boxSelectStart.Y;
            if (Math.Sqrt(dx * dx + dy * dy) >= BoxSelectThreshold)
            {
                _boxSelectArmed = false;
                _isBoxSelecting = true;
                e.Pointer.Capture(this);
                if (_selectionBoxBorder != null)
                {
                    _selectionBoxBorder.IsVisible = true;
                    Canvas.SetLeft(_selectionBoxBorder, _boxSelectStartInOverlay.X);
                    Canvas.SetTop(_selectionBoxBorder, _boxSelectStartInOverlay.Y);
                    _selectionBoxBorder.Width = 0;
                    _selectionBoxBorder.Height = 0;
                    (_selectionBoxBorder.GetVisualParent() as LayoutOverlayPanel)?.InvalidateArrange();
                }
            }
        }

        // Cross-block text selection: state transition is synchronous (capture/armâ†’active).
        if (_crossBlockArmed && _crossBlockAnchorBlock != null)
        {
            if (_crossBlockAnchorBlock.Type != BlockType.Image)
                _isCrossBlockSelecting = true;
            _crossBlockArmed = false;
        }

        bool willBox = _isBoxSelecting;
        bool willCross = _isCrossBlockSelecting && _crossBlockAnchorBlock != null;

        if (!willBox && !willCross)
            return;

        // Mark handled so the event system doesn't propagate further.
        e.Handled = true;

        // For box selection, update the visual rubber-band synchronously (cheap) but coalesce
        // the expensive hit-test pass. For cross-block, coalesce entirely.
        if (willBox)
        {
            var overlay = _selectionBoxBorder?.GetVisualParent() as Visual;
            Point endInOverlay = overlay != null ? e.GetPosition(overlay) : current;
            UpdateSelectionBoxVisual(_boxSelectStartInOverlay, endInOverlay);
        }

        // Coalesce rapid pointer-move events: store the latest position and schedule a single
        // deferred update per render frame. If the dispatcher already has a pending update, just
        // refresh the stored position; the next flush will use the most recent values.
        _pendingPointerPoint = current;
        _pendingPointerIsBox = willBox;
        _pendingPointerIsCross = willCross;

        if (!_pendingPointerUpdateScheduled)
        {
            _pendingPointerUpdateScheduled = true;
            Dispatcher.UIThread.Post(FlushPendingPointerUpdate, DispatcherPriority.Input);
        }
    }

    private void FlushPendingPointerUpdate()
    {
        _pendingPointerUpdateScheduled = false;

        var perf = EditorPerfDiagnostics.Resolve();

        if (_pendingPointerIsBox && _isBoxSelecting)
        {
            var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
            UpdateBoxSelection(_boxSelectStart, _pendingPointerPoint);
            if (perfStart != 0)
                EditorPerfDiagnostics.ReportInteraction(
                    perf,
                    "pointerMoved.boxSelect",
                    EditorPerfDiagnostics.ElapsedMs(perfStart),
                    $"top={Blocks.Count} realized={RealizedRowCount}");
        }

        if (_pendingPointerIsCross && _isCrossBlockSelecting && _crossBlockAnchorBlock != null)
        {
            var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
            UpdateCrossBlockSelection(_pendingPointerPoint);
            if (perfStart != 0)
                EditorPerfDiagnostics.ReportInteraction(
                    perf,
                    "pointerMoved.crossBlock",
                    EditorPerfDiagnostics.ElapsedMs(perfStart),
                    $"top={Blocks.Count} realized={RealizedRowCount}");
        }
    }

    private void Editor_PointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (IsReadOnly)
            return;
        // InitialPressMouseButton is the reliable Avalonia 11+ way to identify which button was
        // released; PointerUpdateKind can return None/Other on some platforms and scenarios.
        if (e.InitialPressMouseButton != MouseButton.Left) return;

        var wasBoxSelecting = _isBoxSelecting;
        var wasBoxArmed = _boxSelectArmed;
        var wasCrossBlockSelecting = _isCrossBlockSelecting;
        var wasArmedButNotDragged = _crossBlockArmed && !_isCrossBlockSelecting && _crossBlockAnchorBlock != null;
        var clickAnchorBlock = _crossBlockAnchorBlock;
        var clickAnchorChar = _crossBlockAnchorCharIndex;

        _boxSelectArmed = false;
        _crossBlockArmed = false;
        _isBoxSelecting = false;
        _isCrossBlockSelecting = false;
        _crossBlockAnchorBlock = null;
        _crossBlockAnchorBlockIndex = -1;
        _lastCrossBlockCurrentIndex = -1;
        // Cancel any coalesced pointer update that was queued but not yet dispatched.
        // The state flags above are already false, so FlushPendingPointerUpdate will be a no-op,
        // but clearing the flag avoids the unnecessary dispatch overhead.
        _pendingPointerUpdateScheduled = false;

        if (wasBoxSelecting)
        {
            e.Pointer.Capture(null);
            if (_selectionBoxBorder != null)
                _selectionBoxBorder.IsVisible = false;
        }
        else if (wasBoxArmed)
        {
            // Plain click on empty space: if at or below the last block, add a new text block and focus it.
            // _boxSelectArmed guarantees the click was outside all block content surfaces, so any point
            // that falls within the last block's row bounds is the dead zone below its visual content
            // (common for Image/Sketch with inflated row heights). We treat that the same as the explicit
            // BelowBlocksArea strip.
            if (IsClickEffectivelyBelowBlocks(_boxSelectStart))
            {
                var lastIsEmpty = IsLastBlockEmptyForBelowBlocksAreaClick(Blocks);
                if (!lastIsEmpty)
                {
                    AddBlock(BlockType.Text, Blocks.Count);
                    if (Blocks.Count > 0)
                    {
                        var newBlock = Blocks[Blocks.Count - 1];
                        Avalonia.Threading.Dispatcher.UIThread.Post(
                            () => newBlock.IsFocused = true,
                            Avalonia.Threading.DispatcherPriority.Render);
                    }
                }
                else if (Blocks.Count > 0)
                {
                    // The trailing block is already an empty text row; focus it instead of
                    // silently ignoring the click.
                    var lastBlock = Blocks[Blocks.Count - 1];
                    lastBlock.PendingCaretIndex = 0;
                    Avalonia.Threading.Dispatcher.UIThread.Post(
                        () => lastBlock.IsFocused = true,
                        Avalonia.Threading.DispatcherPriority.Render);
                }
            }
            e.Pointer.Capture(null);
        }
        else if (wasCrossBlockSelecting)
        {
            e.Pointer.Capture(null);
            if (clickAnchorBlock != null)
            {
                // Resolve directly: Blocks.IndexOf misses anchor blocks nested in two-column rows.
                GetEditableBlockForViewModel(clickAnchorBlock)?.NotifySelectionChangedByEditor();
            }
        }
        else if (wasArmedButNotDragged && clickAnchorBlock != null)
        {
            // Plain click: focus+caret were already set at press time via PendingCaretIndex.
            // Just release the pointer capture that the tunnel handler acquired, then let the
            // toolbar re-evaluate (selection may have been made by the RichTextEditor while
            // toolbar checks were suppressed by the armed flag).
            e.Pointer.Capture(null);
            GetEditableBlockForViewModel(clickAnchorBlock)?.NotifySelectionChangedByEditor();
        }
    }

    /// <param name="start">Start point in selection overlay coordinate space.</param>
    /// <param name="end">End point in selection overlay coordinate space.</param>
    private void UpdateSelectionBoxVisual(Point start, Point end)
    {
        if (_selectionBoxBorder == null) return;
        double x = Math.Min(start.X, end.X);
        double y = Math.Min(start.Y, end.Y);
        double width = Math.Abs(end.X - start.X);
        double height = Math.Abs(end.Y - start.Y);
        Canvas.SetLeft(_selectionBoxBorder, x);
        Canvas.SetTop(_selectionBoxBorder, y);
        _selectionBoxBorder.Width = width;
        _selectionBoxBorder.Height = height;
        (_selectionBoxBorder.GetVisualParent() as LayoutOverlayPanel)?.InvalidateArrange();
    }

    private void UpdateBoxSelection(Point start, Point end)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        var checkedBlocks = 0;
        var realizedHits = 0;
        var selectedHits = 0;

        double minX = Math.Min(start.X, end.X);
        double maxX = Math.Max(start.X, end.X);
        double minY = Math.Min(start.Y, end.Y);
        double maxY = Math.Max(start.Y, end.Y);
        var selectionRect = new Rect(minX, minY, maxX - minX, maxY - minY);

        // Only iterate realized blocks (~8-17 of 1500+). Unrealized blocks have no live UI so
        // their intersection bounds are unavailable anyway; the original code continued past them.
        // When blocks scroll into view during a box-select they are naturally picked up.
        var processed = new HashSet<BlockViewModel>(ReferenceEqualityComparer.Instance);
        foreach (var (vm, editable) in _realizedBlocksByVm)
        {
            checkedBlocks++;
            // Guard against stale containers from virtualization recycling.
            if (!ReferenceEquals(editable.DataContext, vm)) continue;
            realizedHits++;
            processed.Add(vm);

            var bounds = editable.GetBoxSelectIntersectionBoundsRelativeTo(this);
            if (bounds.Width <= 0 || bounds.Height <= 0)
                vm.IsSelected = false;
            else
            {
                vm.IsSelected = selectionRect.Intersects(bounds);
                if (vm.IsSelected)
                    selectedHits++;
            }
        }

        // Blocks that were selected earlier in this drag but are no longer realized (virtualized
        // out or recycled mid-drag) can't be re-tested against the rect; clear them so the box
        // never leaves stray selections behind.
        if (_selectedBlockCount > selectedHits)
        {
            foreach (var vm in GetDocumentOrderBlocks())
            {
                if (vm.IsSelected && !processed.Contains(vm))
                    vm.IsSelected = false;
            }
        }

        if (perfStart != 0)
        {
            EditorPerfDiagnostics.ReportInteraction(
                perf,
                "updateBoxSelection",
                EditorPerfDiagnostics.ElapsedMs(perfStart),
                $"checked={checkedBlocks} realizedHits={realizedHits} selected={selectedHits}");
        }
    }

    #endregion
}
