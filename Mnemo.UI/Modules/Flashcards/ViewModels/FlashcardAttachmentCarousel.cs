using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// One card side's framed image figures for the study shell. Holds up to the first three
/// <see cref="FlashcardAttachment"/>s for a side; a single attachment renders as one framed figure,
/// several as a compact prev/next carousel. Purely presentation state; the study VM re-<see cref="Set"/>s
/// it each time the card changes or is edited.
/// </summary>
public partial class FlashcardAttachmentCarousel : ObservableObject
{
    private const int MaxPerSide = 3;

    private IReadOnlyList<FlashcardAttachment> _items = Array.Empty<FlashcardAttachment>();

    public FlashcardAttachmentCarousel()
    {
        PreviousCommand = new RelayCommand(Previous, () => HasMultiple);
        NextCommand = new RelayCommand(Next, () => HasMultiple);
    }

    public IRelayCommand PreviousCommand { get; }
    public IRelayCommand NextCommand { get; }

    [ObservableProperty]
    private int _index;

    [ObservableProperty]
    private bool _hasAny;

    [ObservableProperty]
    private bool _hasMultiple;

    [ObservableProperty]
    private string? _currentPath;

    [ObservableProperty]
    private string? _currentCaption;

    [ObservableProperty]
    private bool _hasCaption;

    /// <summary>"1 / 3" position label, shown only when the side has more than one figure.</summary>
    [ObservableProperty]
    private string _positionLabel = string.Empty;

    /// <summary>Replaces the side's figures with the (capped) attachments matching <paramref name="side"/>.</summary>
    public void Set(IReadOnlyList<FlashcardAttachment> attachments, string side)
    {
        _items = (attachments ?? Array.Empty<FlashcardAttachment>())
            .Where(a => string.Equals(a.Side, side, StringComparison.OrdinalIgnoreCase))
            .Take(MaxPerSide)
            .ToList();
        Index = 0;
        HasAny = _items.Count > 0;
        HasMultiple = _items.Count > 1;
        PreviousCommand.NotifyCanExecuteChanged();
        NextCommand.NotifyCanExecuteChanged();
        UpdateCurrent();
    }

    private void Previous()
    {
        if (_items.Count == 0)
            return;
        Index = (Index - 1 + _items.Count) % _items.Count;
        UpdateCurrent();
    }

    private void Next()
    {
        if (_items.Count == 0)
            return;
        Index = (Index + 1) % _items.Count;
        UpdateCurrent();
    }

    private void UpdateCurrent()
    {
        if (_items.Count == 0)
        {
            CurrentPath = null;
            CurrentCaption = null;
            HasCaption = false;
            PositionLabel = string.Empty;
            return;
        }

        var current = _items[Math.Clamp(Index, 0, _items.Count - 1)];
        CurrentPath = current.FilePath;
        CurrentCaption = current.Caption;
        HasCaption = !string.IsNullOrWhiteSpace(current.Caption);
        PositionLabel = _items.Count > 1
            ? string.Format(CultureInfo.CurrentCulture, "{0} / {1}", Index + 1, _items.Count)
            : string.Empty;
    }
}
