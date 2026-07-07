using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// One row in the deck view card table. Projects a <see cref="FlashcardView"/> (content +
/// schedule) into presentation state: a single-line front preview with cloze tokens collapsed to a
/// <c>[…]</c> chip, type/tag/due/lapse cells, and the flags the row template reads (attachments,
/// flagged, suspended, selection). Purely display state — all mutations go through the owning
/// <see cref="FlashcardDeckViewModel"/> and the batch card service.
/// </summary>
public partial class FlashcardCardRowViewModel : ObservableObject
{
    private static readonly Regex ClozePattern =
        new(@"\{\{c\d+::(.*?)}}", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.Singleline);

    private readonly ILocalizationService _localization;

    public FlashcardCardRowViewModel(
        FlashcardView view,
        ILocalizationService localization,
        DateTimeOffset now,
        ObservableCollection<FlashcardDeckMenuItem> moveTargets)
    {
        _localization = localization;
        MoveTargets = moveTargets;
        Apply(view, now);
    }

    /// <summary>
    /// Shared "move this card to another deck" targets (the deck view's live deck list). Bound by the
    /// row context menu directly on its own DataContext so no binding crosses the popup namescope.
    /// </summary>
    public ObservableCollection<FlashcardDeckMenuItem> MoveTargets { get; }

    /// <summary>Card id (stable across refresh; drives selection tracking and per-row commands).</summary>
    public string Id { get; private set; } = string.Empty;

    public FlashcardType Type { get; private set; }

    /// <summary>Front preview with cloze markers collapsed and newlines flattened, for the FRONT cell.</summary>
    public string FrontPreview { get; private set; } = string.Empty;

    /// <summary>Localized card type label ("Classic" / "Cloze") for the TYPE cell.</summary>
    public string TypeLabel { get; private set; } = string.Empty;

    /// <summary>First tag shown as a muted chip, or empty when the card has no tags.</summary>
    public string FirstTag { get; private set; } = string.Empty;

    public bool HasTag => FirstTag.Length > 0;

    /// <summary>Compact due text: "today" (due now), "2d" (future), or "—" (suspended).</summary>
    public string DueText { get; private set; } = string.Empty;

    /// <summary>True when the card is due now (renders the due cell accent-red).</summary>
    public bool IsDueNow { get; private set; }

    /// <summary>Lapse count for the LAPSES cell.</summary>
    public string LapsesText { get; private set; } = string.Empty;

    public bool IsSuspended { get; private set; }

    public bool IsFlagged { get; private set; }

    public bool HasAttachments { get; private set; }

    public bool IsCloze => Type == FlashcardType.Cloze;

    [ObservableProperty]
    private bool _isSelected;

    /// <summary>Re-projects the row from a fresh <see cref="FlashcardView"/>, preserving selection.</summary>
    public void Apply(FlashcardView view, DateTimeOffset now)
    {
        var card = view.Card;
        var schedule = view.Schedule;

        Id = card.Id;
        Type = card.Type;
        FrontPreview = BuildFrontPreview(card.Front);
        TypeLabel = _localization.T(card.Type == FlashcardType.Cloze ? "TypeCloze" : "TypeClassic", "Flashcards");
        FirstTag = card.Tags.Count > 0 ? card.Tags[0] : string.Empty;
        IsSuspended = card.State == FlashcardCardState.Suspended;
        IsFlagged = card.IsFlagged;
        HasAttachments = card.Attachments.Count > 0;
        LapsesText = schedule.Lapses.ToString(CultureInfo.CurrentCulture);
        (DueText, IsDueNow) = FormatDue(schedule, now);

        OnPropertyChanged(nameof(Id));
        OnPropertyChanged(nameof(Type));
        OnPropertyChanged(nameof(FrontPreview));
        OnPropertyChanged(nameof(TypeLabel));
        OnPropertyChanged(nameof(FirstTag));
        OnPropertyChanged(nameof(HasTag));
        OnPropertyChanged(nameof(DueText));
        OnPropertyChanged(nameof(IsDueNow));
        OnPropertyChanged(nameof(LapsesText));
        OnPropertyChanged(nameof(IsSuspended));
        OnPropertyChanged(nameof(IsFlagged));
        OnPropertyChanged(nameof(HasAttachments));
        OnPropertyChanged(nameof(IsCloze));
    }

    /// <summary>Collapses <c>{{cN::text}}</c> to <c>[…]</c> and flattens whitespace to a single line.</summary>
    private static string BuildFrontPreview(string front)
    {
        if (string.IsNullOrEmpty(front))
            return string.Empty;
        var collapsed = ClozePattern.Replace(front, "[…]");
        collapsed = collapsed.Replace('\n', ' ').Replace('\r', ' ');
        // Collapse runs of whitespace so a single-line cell reads cleanly.
        return Regex.Replace(collapsed, @"\s+", " ").Trim();
    }

    /// <summary>
    /// Compact due formatting matching the library's convention: suspended → "—" (never due),
    /// due now → localized "today" (accent-red), otherwise "Nd" muted where N is whole days ahead.
    /// </summary>
    private (string Text, bool IsDueNow) FormatDue(FlashcardSchedule schedule, DateTimeOffset now)
    {
        if (IsSuspended)
            return ("—", false);

        if (schedule.DueDate <= now)
            return (_localization.T("DueTodayCompact", "Flashcards"), true);

        var days = (int)Math.Ceiling((schedule.DueDate - now).TotalDays);
        if (days < 1)
            days = 1;
        return (string.Format(CultureInfo.CurrentCulture, _localization.T("DueInDaysFormat", "Flashcards"), days), false);
    }
}
