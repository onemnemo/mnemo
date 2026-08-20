using System;
using Mnemo.Core.Models;

namespace Mnemo.UI.Components.BlockEditor;

public partial class BlockViewModel
{
    private bool _isFocused;
    private int? _pendingCaretIndex;

    public bool IsFocused
    {
        get => _isFocused;
        set
        {
            if (_isFocused == value)
                return;

            _isFocused = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(Watermark));
        }
    }

    /// <summary>
    /// When set, EditableBlock should move the caret to this index after the next focus.
    /// The consumer is responsible for clearing this value after use.
    /// </summary>
    public int? PendingCaretIndex
    {
        get => _pendingCaretIndex;
        set { _pendingCaretIndex = value; OnPropertyChanged(); }
    }

    /// <summary>When set with <see cref="PendingCaretPlaceOnLastLine"/>, positions the caret by horizontal pixel column (see <see cref="RichTextEditor.GetCaretIndexFromHorizontalOffset"/>).</summary>
    public double? PendingCaretPixelX { get; set; }

    /// <summary>True: Up into this block, use last visual line. False: Down into this block, first line.</summary>
    public bool PendingCaretPlaceOnLastLine { get; set; }

    public event Action<BlockViewModel>? DeleteAndFocusAboveRequested;
    public event Action<BlockViewModel, double?>? FocusPreviousRequested;
    public event Action<BlockViewModel, double?>? FocusNextRequested;
    public event Action<BlockViewModel>? MergeWithPreviousRequested;
    public event Action<BlockViewModel, string?>? ExitSplitBelowRequested;

    public void RequestDeleteAndFocusAbove()
    {
        DeleteAndFocusAboveRequested?.Invoke(this);
    }

    public void RequestFocusPrevious(double? caretPixelX = null)
    {
        FocusPreviousRequested?.Invoke(this, caretPixelX);
    }

    public void RequestFocusNext(double? caretPixelX = null)
    {
        FocusNextRequested?.Invoke(this, caretPixelX);
    }

    public void RequestMergeWithPrevious()
    {
        MergeWithPreviousRequested?.Invoke(this);
    }

    public void RequestExitSplitBelow(string? followingText)
    {
        ExitSplitBelowRequested?.Invoke(this, followingText);
    }
}
