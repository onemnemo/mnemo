using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.LogicalTree;
using Avalonia.Media;
using Avalonia.VisualTree;
using Mnemo.Core.Models;
using System;
using System.Threading.Tasks;

namespace Mnemo.UI.Components.BlockEditor;

public partial class EditableBlock
{
    // ── XAML-named element accessors for BlockChromeController ───────────────

    internal Avalonia.Controls.Grid? ChromeGrid => BlockLayoutGrid;
    internal Border? ChromeAddBelow => AddBlockBelowBorder;
    internal Border? ChromeDragHandle => DragHandleBorder;
    internal Avalonia.Controls.Shapes.Path? ChromeAddBelowIcon => AddBlockBelowIcon;
    internal Avalonia.Controls.Shapes.Path? ChromeDragHandleGrip => DragHandleGripPath;

    // ── Drag and Drop ────────────────────────────────────────────────────────

    /// <summary>Root visual captured for block-reorder drag ghost (handle + content).</summary>
    internal Visual BlockDragSnapshotTarget => BlockContainer;

    private void BlockContainer_PointerEntered(object? sender, PointerEventArgs e)
        => _chrome?.SetGutterVisible(true);

    private void BlockContainer_PointerExited(object? sender, PointerEventArgs e)
        => _chrome?.SetGutterVisible(false);

    private void BlockGutterBorder_PointerEntered(object? sender, PointerEventArgs e)
        => _chrome?.OnGutterBorderPointerEntered(sender as Border);

    private void BlockGutterBorder_PointerExited(object? sender, PointerEventArgs e)
        => _chrome?.OnGutterBorderPointerExited(sender as Border);

    private void AddBlockBelow_Tapped(object? sender, TappedEventArgs e)
    {
        if (!(_chrome?.GutterVisible ?? false) || _viewModel == null) return;
        e.Handled = true;
        _viewModel.NotifyStructuralChangeStarting();
        _viewModel.RequestNewBlock();
    }

    private void DragHandle_PointerPressed(object? sender, PointerPressedEventArgs e)
        => _chrome?.OnDragHandlePointerPressed(e);

    private void DragHandle_PointerMoved(object? sender, PointerEventArgs e)
        => _chrome?.OnDragHandlePointerMoved(e);

    private void DragHandle_PointerReleased(object? sender, PointerReleasedEventArgs e)
        => _chrome?.OnDragHandlePointerReleased(e);

    private void DragHandle_PointerCaptureLost(object? sender, PointerCaptureLostEventArgs e)
        => _chrome?.OnDragHandlePointerCaptureLost(e);

    /// <summary>Gutter handle or image chrome (after move threshold); same payload and ghost as the drag handle.</summary>
    internal async Task BeginBlockReorderDragCoreAsync(PointerPressedEventArgs e)
    {
        if (_viewModel == null) return;

        var editor = FindParentBlockEditor();
        if (editor == null) return;

        var payload = editor.CreateBlockReorderPayload(_viewModel, e.KeyModifiers, e.GetPosition(editor));
        editor.ClearBlockSelection();

        var transfer = new DataTransfer();
        transfer.Add(DataTransferItem.Create(BlockViewModel.BlockDragDataFormat, payload.Primary));
        transfer.Add(DataTransferItem.Create(BlockViewModel.BlockReorderDragPayload.Format, payload));

        editor.BeginBlockDragGhost(this, e);
        try
        {
            await DragDrop.DoDragDropAsync(e, transfer, DragDropEffects.Move).ConfigureAwait(true);
        }
        finally
        {
            editor.EndBlockDragGhost();
        }
    }

    private static bool TryResolveBlockReorderPayload(DragEventArgs e, out BlockViewModel.BlockReorderDragPayload? payload)
    {
        if (e.DataTransfer.TryGetValue(BlockViewModel.BlockReorderDragPayload.Format) is BlockViewModel.BlockReorderDragPayload p)
        {
            payload = p;
            return true;
        }

        if (e.DataTransfer.TryGetValue(BlockViewModel.BlockDragDataFormat) is not { } vm)
        {
            payload = null;
            return false;
        }

        payload = new BlockViewModel.BlockReorderDragPayload
        {
            Primary = vm,
            BlocksInDocumentOrder = new[] { vm }
        };
        return true;
    }

    private void Block_DragOver(object? sender, DragEventArgs e)
    {
        if (!e.DataTransfer.Contains(BlockViewModel.BlockDragDataFormat)
            && !e.DataTransfer.Contains(BlockViewModel.BlockReorderDragPayload.Format))
        {
            e.DragEffects = DragDropEffects.None;
            return;
        }

        if (!TryResolveBlockReorderPayload(e, out var payload) || payload == null)
        {
            e.DragEffects = DragDropEffects.None;
            return;
        }

        var parent = FindParentBlockEditor();
        Point cursorInEditor = parent != null ? e.GetPosition(parent) : default;
        if (parent != null)
            parent.UpdateBlockDragGhostFromEditorPoint(cursorInEditor);

        if (payload.BlocksInDocumentOrder.Count == 1 && ReferenceEquals(payload.Primary, _viewModel))
        {
            var blocks = parent?.Blocks;
            if (blocks == null || payload.Primary.GetColumnSibling(blocks) == null)
            {
                e.DragEffects = DragDropEffects.Move;
                return;
            }
        }

        e.DragEffects = DragDropEffects.Move;

        if (parent == null) return;

        parent.HandleBlockDragOver(cursorInEditor, payload);
        e.Handled = true;
    }

    public void ShowDropLineAtLeft()
    {
        if (DropIndicatorLineVerticalRight != null) DropIndicatorLineVerticalRight.IsVisible = false;
        if (DropIndicatorLineVerticalLeft != null) DropIndicatorLineVerticalLeft.IsVisible = true;
    }

    public void ShowDropLineAtRight()
    {
        if (DropIndicatorLineVerticalLeft != null) DropIndicatorLineVerticalLeft.IsVisible = false;
        if (DropIndicatorLineVerticalRight != null) DropIndicatorLineVerticalRight.IsVisible = true;
    }

    public void HideDropLine()
    {
        if (DropIndicatorLineVerticalLeft != null) DropIndicatorLineVerticalLeft.IsVisible = false;
        if (DropIndicatorLineVerticalRight != null) DropIndicatorLineVerticalRight.IsVisible = false;
    }

    private void Block_DragLeave(object? sender, DragEventArgs e) { }

    private void Block_Drop(object? sender, DragEventArgs e)
    {
        if (_viewModel == null) return;
        if (!TryResolveBlockReorderPayload(e, out var payload) || payload == null) return;

        var parent = FindParentBlockEditor();
        if (parent == null) return;

        var dropPosInEditor = e.GetPosition(parent);
        parent.HandleBlockDragOver(dropPosInEditor, payload);

        try
        {
            parent.TryPerformDrop(payload);
        }
        catch (Exception) { }
        finally
        {
            parent.ClearDropIndicator();
        }

        e.Handled = true;
    }

    private RichTextEditor? GetRichEditor() => _currentBlockComponent?.GetRichTextEditor();
    private TextBox? GetPlainEditor() => _currentBlockComponent?.GetLegacyTextBox();

    /// <summary>Live rich-text control when this block is not using a plain <see cref="TextBox"/>.</summary>
    public RichTextEditor? TryGetRichTextEditor() => GetRichEditor();

    public string? GetSelectedText()
    {
        var range = GetSelectionRange();
        if (range == null || _viewModel == null) return null;
        var content = _viewModel.Content ?? string.Empty;
        int start = Math.Clamp(range.Value.start, 0, content.Length);
        int end = Math.Clamp(range.Value.end, 0, content.Length);
        if (start >= end) return null;
        return content.Substring(start, end - start);
    }

    /// <summary>
    /// True when the editor has a non-collapsed range the user (or cross-block delete) should treat as selected text.
    /// Empty paragraphs use selection upper bound 1 for drag geometry only; not a real text selection.
    /// </summary>
    internal static bool HasActiveTextSelection(RichTextEditor rte)
    {
        int start = Math.Min(rte.SelectionStart, rte.SelectionEnd);
        int end = Math.Max(rte.SelectionStart, rte.SelectionEnd);
        if (start >= end) return false;
        if (rte.TextLength == 0 && start == 0 && end <= 1)
            return false;
        return true;
    }

    public (int start, int end)? GetSelectionRange()
    {
        if (GetRichEditor() is { } rte)
        {
            if (!HasActiveTextSelection(rte)) return null;
            int start = Math.Min(rte.SelectionStart, rte.SelectionEnd);
            int end = Math.Max(rte.SelectionStart, rte.SelectionEnd);
            return (start, end);
        }
        if (GetPlainEditor() is { } tb)
        {
            int start = Math.Min(tb.SelectionStart, tb.SelectionEnd);
            int end = Math.Max(tb.SelectionStart, tb.SelectionEnd);
            if (start >= end) return null;
            return (start, end);
        }
        return null;
    }

    internal bool DoesSelectionHaveLink()
    {
        if (_viewModel == null) return false;
        var range = GetSelectionRange();
        if (range == null) return false;
        return FormattingToolbarCoordinator.GetFormatStateForRange(_viewModel.Spans, range.Value.start, range.Value.end).hasLink;
    }

    public int? GetCaretIndex()
    {
        if (GetRichEditor() is { } rte) return rte.CaretIndex;
        if (GetPlainEditor() is { } tb) return tb.CaretIndex;
        return null;
    }

    public (int start, int end)? GetSelectionOrCaretRange()
    {
        if (GetRichEditor() is { } rte)
            return (Math.Min(rte.SelectionStart, rte.SelectionEnd), Math.Max(rte.SelectionStart, rte.SelectionEnd));
        if (GetPlainEditor() is { } tb)
            return (Math.Min(tb.SelectionStart, tb.SelectionEnd), Math.Max(tb.SelectionStart, tb.SelectionEnd));
        return null;
    }

    public void SetCaretIndex(int index)
    {
        if (GetRichEditor() is { } rte)
        {
            int c = Math.Clamp(index, 0, rte.TextLength);
            rte.CaretIndex = c; rte.SelectionStart = c; rte.SelectionEnd = c;
            return;
        }
        if (GetPlainEditor() is { } tb)
        {
            var len = tb.Text?.Length ?? 0;
            int c = Math.Clamp(index, 0, len);
            tb.CaretIndex = c; tb.SelectionStart = c; tb.SelectionEnd = c;
        }
    }

    public bool DeleteSelection()
    {
        var range = GetSelectionRange();
        if (range == null || _viewModel == null) return false;
        if (GetPlainEditor() is { } plainTb)
        {
            var plainText = plainTb.Text ?? string.Empty;
            int delStart = range.Value.start, delEnd = range.Value.end;
            if (delEnd <= delStart || delStart < 0 || delEnd > plainText.Length) return false;
            var newPlain = plainText.Remove(delStart, delEnd - delStart);
            _viewModel.Content = newPlain;
            plainTb.Text = newPlain;
            plainTb.CaretIndex = delStart; plainTb.SelectionStart = delStart; plainTb.SelectionEnd = delStart;
            return true;
        }
        var editor = GetRichEditor();
        if (editor == null) return false;
        string text = editor.Text;
        int start = range.Value.start, end = range.Value.end, len = end - start;
        if (text.Length == 0 && start == 0 && end == 1)
        {
            editor.SelectionStart = 0; editor.SelectionEnd = 0; editor.CaretIndex = 0;
            return true;
        }
        if (len <= 0 || start < 0 || start + len > text.Length) return false;
        editor.SelectionStart = start;
        editor.SelectionEnd = start + len;
        var newRuns = Core.Formatting.InlineSpanFormatApplier.ApplyTextEdit(editor.Spans, text, text.Remove(start, len));
        editor.Spans = newRuns;
        editor.CaretIndex = start; editor.SelectionStart = start; editor.SelectionEnd = start;
        _viewModel.CommitSpansFromEditor(editor.Spans);
        return true;
    }

    public bool InsertTextAtCursor(string text)
    {
        if (GetPlainEditor() is { } plain)
        {
            if (_viewModel == null) return false;
            int insStart = Math.Min(plain.SelectionStart, plain.SelectionEnd);
            int insEnd = Math.Max(plain.SelectionStart, plain.SelectionEnd);
            var plainFlat = plain.Text ?? string.Empty;
            insStart = Math.Clamp(insStart, 0, plainFlat.Length);
            insEnd = Math.Clamp(insEnd, 0, plainFlat.Length);
            var inserted = plainFlat.Remove(insStart, insEnd - insStart).Insert(insStart, text);
            _viewModel.Content = inserted;
            plain.Text = inserted;
            var caret = insStart + text.Length;
            plain.CaretIndex = caret; plain.SelectionStart = caret; plain.SelectionEnd = caret;
            return true;
        }
        var editor = GetRichEditor();
        if (editor == null || _viewModel == null) return false;
        int s = Math.Clamp(Math.Min(editor.SelectionStart, editor.SelectionEnd), 0, editor.Text.Length);
        int e2 = Math.Clamp(Math.Max(editor.SelectionStart, editor.SelectionEnd), 0, editor.Text.Length);
        var flat = editor.Text;
        var newFlat = flat.Remove(s, e2 - s).Insert(s, text);
        var newRuns = Core.Formatting.InlineSpanFormatApplier.ApplyTextEdit(editor.Spans, flat, newFlat);
        editor.Spans = newRuns;
        int nc = s + text.Length;
        editor.CaretIndex = nc; editor.SelectionStart = nc; editor.SelectionEnd = nc;
        _viewModel.CommitSpansFromEditor(editor.Spans);
        return true;
    }

    public int GetAnchorCharClampMax()
    {
        var rte = TryGetRichTextEditor();
        if (rte != null) return rte.TextLength;
        return _viewModel?.Content?.Length ?? 0;
    }

    public int GetLogicalTextLengthForCrossBlockSelection()
    {
        var rte = TryGetRichTextEditor();
        if (rte != null) return rte.SelectionIndexUpperBound;
        return _viewModel?.Content?.Length ?? 0;
    }

    public void ApplyTextSelection(int start, int end)
    {
        if (GetPlainEditor() is { } plainSelTb)
        {
            int plainLen = plainSelTb.Text?.Length ?? 0;
            int ps = Math.Clamp(Math.Min(start, end), 0, plainLen);
            int pe = Math.Clamp(Math.Max(start, end), 0, plainLen);
            plainSelTb.SelectionStart = ps; plainSelTb.SelectionEnd = pe; plainSelTb.CaretIndex = pe;
            return;
        }
        var editor = GetRichEditor();
        if (editor == null) return;
        int len = editor is RichTextEditor rte2 ? rte2.SelectionIndexUpperBound : editor.TextLength;
        int selStart = Math.Clamp(Math.Min(start, end), 0, len);
        int selEnd = Math.Clamp(Math.Max(start, end), 0, len);
        bool isClear = selStart == 0 && selEnd == 0;
        bool alreadyClear = editor.SelectionStart == 0 && editor.SelectionEnd == 0;
        if (isClear && alreadyClear) return;
        editor.SelectionStart = selStart;
        editor.SelectionEnd = selEnd;
    }

    public bool IsPointerHitInsideBlock(Point pointInThis)
    {
        if (_viewModel?.Type is not BlockType.Image and not BlockType.Sketch)
            return new Rect(0, 0, Bounds.Width, Bounds.Height).Contains(pointInThis);

        if (HitTestChromeSizedBlockTarget(AddBlockBelowBorder, pointInThis)) return true;
        if (HitTestChromeSizedBlockTarget(DragHandleBorder, pointInThis)) return true;
        if (HitTestChromeSizedBlockTarget(BlockContentControl, pointInThis)) return true;
        return false;
    }

    private bool HitTestChromeSizedBlockTarget(Control? child, Point pointInThis)
    {
        if (child == null) return false;
        var topLeft = child.TranslatePoint(new Point(0, 0), this);
        if (!topLeft.HasValue) return false;
        var rect = new Rect(topLeft.Value, child.Bounds.Size);
        return rect.Contains(pointInThis);
    }

    public Rect GetBoxSelectIntersectionBoundsRelativeTo(Visual relativeTo)
    {
        if (_viewModel?.Type is not BlockType.Image and not BlockType.Sketch)
        {
            var topLeft = this.TranslatePoint(new Point(0, 0), relativeTo);
            if (!topLeft.HasValue) return default;
            return new Rect(topLeft.Value, Bounds.Size);
        }

        Rect? union = null;
        void Add(Control? c)
        {
            if (c == null) return;
            var tl = c.TranslatePoint(new Point(0, 0), relativeTo);
            if (!tl.HasValue) return;
            var r = new Rect(tl.Value, c.Bounds.Size);
            union = union.HasValue ? union.Value.Union(r) : r;
        }
        Add(AddBlockBelowBorder);
        Add(DragHandleBorder);
        Add(BlockContentControl);
        return union ?? default;
    }

    /// <summary>
    /// Maps a point (block coordinates) to a character index.
    /// Returns -1 when the position cannot be resolved (editor not wired yet, layout in flight);
    /// callers must pick a sensible fallback instead of snapping the caret to 0.
    /// </summary>
    public int GetCharacterIndexFromPoint(Point pointInBlock)
    {
        if (GetRichEditor() is { } editor)
        {
            var ptInEditor = this.TranslatePoint(pointInBlock, editor);
            if (!ptInEditor.HasValue) return -1;
            return editor.HitTestPoint(ptInEditor.Value);
        }
        if (GetPlainEditor() is { } tb)
        {
            var ptInTb = this.TranslatePoint(pointInBlock, tb);
            if (!ptInTb.HasValue) return -1;
            var rel = ptInTb.Value;
            var lineHeight = tb.FontSize * 1.35;
            if (lineHeight <= 0) return -1;
            var text = tb.Text ?? string.Empty;
            var line = Math.Clamp((int)(rel.Y / lineHeight), 0, int.MaxValue);
            var col = Math.Max(0, (int)(rel.X / (tb.FontSize * 0.55)));
            var lines = text.Split('\n');
            if (line >= lines.Length) return text.Length;
            var lineStart = 0;
            for (int i = 0; i < line; i++) lineStart += lines[i].Length + 1;
            return Math.Clamp(lineStart + Math.Min(col, lines[line].Length), 0, text.Length);
        }
        return -1;
    }

    internal BlockEditor? FindParentBlockEditor()
    {
        if (_cachedParentEditor != null) return _cachedParentEditor;

        var current = this.GetVisualParent();
        while (current != null)
        {
            if (current is BlockEditor blockEditor) { _cachedParentEditor = blockEditor; return blockEditor; }
            current = current.GetVisualParent();
        }

        var logicalCurrent = this.GetLogicalParent();
        while (logicalCurrent != null)
        {
            if (logicalCurrent is BlockEditor blockEditor) { _cachedParentEditor = blockEditor; return blockEditor; }
            logicalCurrent = logicalCurrent.GetLogicalParent();
        }

        return null;
    }
}
