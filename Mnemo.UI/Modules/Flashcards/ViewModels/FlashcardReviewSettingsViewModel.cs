using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>
/// Sidebar row for a single preset: name, deck-count label, selection and inline-rename state.
/// One instance per preset (existing or newly drafted, not yet persisted).
/// </summary>
public partial class FlashcardPresetItemViewModel : ObservableObject
{
    public FlashcardPresetItemViewModel(string id, bool isNew)
    {
        Id = id;
        IsNew = isNew;
    }

    /// <summary>Stable preset id. Newly created drafts get a fresh GUID that becomes permanent on Save.</summary>
    public string Id { get; }

    /// <summary>True until the first successful Save persists this preset.</summary>
    public bool IsNew { get; set; }

    [ObservableProperty]
    private string _name = string.Empty;

    [ObservableProperty]
    private string _deckCountLabel = string.Empty;

    [ObservableProperty]
    private int _deckCount;

    [ObservableProperty]
    private bool _isSelected;

    [ObservableProperty]
    private bool _isRenaming;

    /// <summary>Draft text bound to the rename TextBox; committed back to <see cref="Name"/> on confirm.</summary>
    [ObservableProperty]
    private string _renameText = string.Empty;

    public bool IsStandard => string.Equals(Id, FlashcardPreset.StandardPresetId, StringComparison.Ordinal);

    /// <summary>Delete is only offered for non-standard presets that no deck currently uses.</summary>
    public bool CanDelete => !IsStandard && DeckCount == 0;

    partial void OnDeckCountChanged(int value) => OnPropertyChanged(nameof(CanDelete));
}

/// <summary>Display item for the auto-reveal ModernComboBox: enum value + its localized label.</summary>
public sealed record FlashcardAutoRevealOption(FlashcardAutoReveal Value, string Label)
{
    public override string ToString() => Label;
}

/// <summary>
/// In-memory editable copy of a <see cref="FlashcardPreset"/>. One draft exists per preset row for
/// the lifetime of the dialog; edits mutate the draft only, and Save persists every dirty draft.
/// </summary>
internal sealed class FlashcardPresetDraft
{
    public required string Id { get; init; }
    public required string Name { get; set; }
    public required int NewPerDay { get; set; }
    public required int MaxReviewsPerDay { get; set; }
    public required FlashcardSchedulingAlgorithm Algorithm { get; set; }
    public required double DesiredRetention { get; set; }
    public required IReadOnlyList<int> LearningSteps { get; set; }
    public required IReadOnlyList<int> RelearnSteps { get; set; }
    public required bool ShuffleOrder { get; set; }
    public required bool BuryRelated { get; set; }
    public required FlashcardAutoReveal AutoReveal { get; set; }
    public IReadOnlyList<double>? Weights { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Whether anything in this draft differs from what was loaded/created (including the name).</summary>
    public bool IsDirty { get; set; }

    public static FlashcardPresetDraft FromPreset(FlashcardPreset preset) => new()
    {
        Id = preset.Id,
        Name = preset.Name,
        NewPerDay = preset.NewPerDay,
        MaxReviewsPerDay = preset.MaxReviewsPerDay,
        Algorithm = preset.Algorithm,
        DesiredRetention = preset.DesiredRetention,
        LearningSteps = preset.LearningSteps,
        RelearnSteps = preset.RelearnSteps,
        ShuffleOrder = preset.ShuffleOrder,
        BuryRelated = preset.BuryRelated,
        AutoReveal = preset.AutoReveal,
        Weights = preset.Weights,
        CreatedAt = preset.CreatedAt,
        UpdatedAt = preset.UpdatedAt,
        IsDirty = false
    };

    public FlashcardPreset ToPreset(DateTimeOffset now) => new(
        Id: Id,
        Name: Name,
        NewPerDay: NewPerDay,
        MaxReviewsPerDay: MaxReviewsPerDay,
        Algorithm: Algorithm,
        DesiredRetention: DesiredRetention,
        LearningSteps: LearningSteps,
        RelearnSteps: RelearnSteps,
        ShuffleOrder: ShuffleOrder,
        BuryRelated: BuryRelated,
        AutoReveal: AutoReveal,
        Weights: Weights,
        CreatedAt: CreatedAt == default ? now : CreatedAt,
        UpdatedAt: now);

    /// <summary>Resets scheduling values (not id/name) back to FSRS-6 defaults, e.g. "Restore defaults".</summary>
    public void ResetValuesToStandard(DateTimeOffset now)
    {
        var standard = FlashcardPreset.CreateStandard(now);
        NewPerDay = standard.NewPerDay;
        MaxReviewsPerDay = standard.MaxReviewsPerDay;
        Algorithm = standard.Algorithm;
        DesiredRetention = standard.DesiredRetention;
        LearningSteps = standard.LearningSteps;
        RelearnSteps = standard.RelearnSteps;
        ShuffleOrder = standard.ShuffleOrder;
        BuryRelated = standard.BuryRelated;
        AutoReveal = standard.AutoReveal;
        Weights = standard.Weights;
    }
}

/// <summary>
/// VM for the "Review settings" preset dialog: a sidebar of shared scheduling presets and a
/// details pane editing the selected preset's daily limits, scheduling and session behaviour.
/// Editing a preset changes every deck bound to it; Save persists every dirty draft in one shot and,
/// when opened with deck context, may re-bind the deck to a different preset.
/// </summary>
public partial class FlashcardReviewSettingsViewModel : ViewModelBase
{
    private readonly IFlashcardPresetService _presetService;
    private readonly IFlashcardLibraryService _libraryService;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;

    /// <summary>token separator: spaces, commas, or middle dots.</summary>
    private static readonly Regex LearningStepsSplitPattern = new(@"[\s,·]+", RegexOptions.Compiled);
    private static readonly Regex LearningStepsTokenPattern = new(@"^(\d+)m?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly Dictionary<string, FlashcardPresetDraft> _drafts = new(StringComparer.Ordinal);
    private readonly HashSet<string> _persistedPresetIds = new(StringComparer.Ordinal);

    private string? _deckId;
    private string? _originalDeckPresetId;

    public FlashcardReviewSettingsViewModel(
        IFlashcardPresetService presetService,
        IFlashcardLibraryService libraryService,
        IOverlayService overlay,
        ILocalizationService localization)
    {
        _presetService = presetService;
        _libraryService = libraryService;
        _overlay = overlay;
        _localization = localization;

        SelectPresetCommand = new RelayCommand<FlashcardPresetItemViewModel?>(SelectPreset);
        CreatePresetCommand = new RelayCommand(CreatePreset);
        BeginRenameCommand = new RelayCommand<FlashcardPresetItemViewModel?>(BeginRename);
        CommitRenameCommand = new RelayCommand<FlashcardPresetItemViewModel?>(CommitRename);
        CancelRenameCommand = new RelayCommand<FlashcardPresetItemViewModel?>(CancelRename);
        DeletePresetCommand = new AsyncRelayCommand<FlashcardPresetItemViewModel?>(DeletePresetAsync);
        RestoreDefaultsCommand = new RelayCommand(RestoreDefaults);
        SaveCommand = new AsyncRelayCommand(SaveAsync);

        AutoRevealOptions = new[]
        {
            new FlashcardAutoRevealOption(FlashcardAutoReveal.Off, _localization.T("ReviewSettingsAutoRevealOff", "Flashcards")),
            new FlashcardAutoRevealOption(FlashcardAutoReveal.FiveSeconds, _localization.T("ReviewSettingsAutoReveal5s", "Flashcards")),
            new FlashcardAutoRevealOption(FlashcardAutoReveal.TenSeconds, _localization.T("ReviewSettingsAutoReveal10s", "Flashcards"))
        };
        _selectedAutoRevealOption = AutoRevealOptions[0];
    }

    public ObservableCollection<FlashcardPresetItemViewModel> Presets { get; } = new();

    [ObservableProperty]
    private FlashcardPresetItemViewModel? _selectedPreset;

    [ObservableProperty]
    private bool _isLoading = true;

    /// <summary>Only shown when the dialog was opened with deck context.</summary>
    [ObservableProperty]
    private string? _deckName;

    public bool HasDeckContext => !string.IsNullOrEmpty(DeckName);

    /// <summary>"Editing {name} changes every deck that uses it." for the currently selected preset.</summary>
    public string EditingNoteText => SelectedPreset == null
        ? string.Empty
        : string.Format(CultureInfo.CurrentCulture, EditingNoteFormat, SelectedPreset.Name);

    // --- Selected-draft-backed editable fields ------------------------------------------------

    [ObservableProperty]
    private int _newPerDay;

    [ObservableProperty]
    private int _maxReviewsPerDay;

    /// <summary>Only "FSRS-6" is offered today; kept as a single-item list so the row matches other ModernComboBox rows.</summary>
    public IReadOnlyList<string> AlgorithmOptions { get; } = new[] { "FSRS-6" };

    [ObservableProperty]
    private string _selectedAlgorithmOption = "FSRS-6";

    /// <summary>Integer percent 80-97 bound to the slider; persisted as DesiredRetention/100.</summary>
    [ObservableProperty]
    private int _desiredRetentionPercent;

    public string DesiredRetentionLabel => string.Create(CultureInfo.InvariantCulture, $"{DesiredRetentionPercent}%");

    [ObservableProperty]
    private string _learningStepsText = string.Empty;

    [ObservableProperty]
    private bool _hasLearningStepsError;

    [ObservableProperty]
    private bool _shuffleOrder;

    /// <summary>Feature ships disabled ("coming soon") — the toggle is never actionable; value is carried through unchanged.</summary>
    [ObservableProperty]
    private bool _buryRelated;

    public IReadOnlyList<FlashcardAutoRevealOption> AutoRevealOptions { get; }

    [ObservableProperty]
    private FlashcardAutoRevealOption? _selectedAutoRevealOption;

    [ObservableProperty]
    private bool _hasUnsavedChanges;

    [ObservableProperty]
    private bool _canSave;

    // --- Localized strings (bound by the view; refreshed once in InitializeAsync) -------------

    public string TitleText => _localization.T("ReviewSettingsTitle", "Flashcards");
    public string PresetsLabel => _localization.T("ReviewSettingsPresetsLabel", "Flashcards");
    public string NewPresetLabel => _localization.T("ReviewSettingsNewPreset", "Flashcards");
    public string EditingNoteFormat => _localization.T("ReviewSettingsEditingNoteFormat", "Flashcards");
    public string DailyLimitsLabel => _localization.T("ReviewSettingsDailyLimitsLabel", "Flashcards");
    public string NewPerDayTitle => _localization.T("ReviewSettingsNewPerDayTitle", "Flashcards");
    public string MaxReviewsTitle => _localization.T("ReviewSettingsMaxReviewsTitle", "Flashcards");
    public string SchedulingLabel => _localization.T("ReviewSettingsSchedulingLabel", "Flashcards");
    public string AlgorithmTitle => _localization.T("ReviewSettingsAlgorithmTitle", "Flashcards");
    public string RetentionTitle => _localization.T("ReviewSettingsRetentionTitle", "Flashcards");
    public string RetentionDescription => _localization.T("ReviewSettingsRetentionDescription", "Flashcards");
    public string LearningStepsTitle => _localization.T("ReviewSettingsLearningStepsTitle", "Flashcards");
    public string LearningStepsDescription => _localization.T("ReviewSettingsLearningStepsDescription", "Flashcards");
    public string SessionLabel => _localization.T("ReviewSettingsSessionLabel", "Flashcards");
    public string ShuffleTitle => _localization.T("ReviewSettingsShuffleTitle", "Flashcards");
    public string BuryTitle => _localization.T("ReviewSettingsBuryTitle", "Flashcards");
    public string BuryDescription => _localization.T("ReviewSettingsBuryComingSoon", "Flashcards");
    public string AutoRevealTitle => _localization.T("ReviewSettingsAutoRevealTitle", "Flashcards");
    public string RestoreDefaultsText => _localization.T("ReviewSettingsRestoreDefaults", "Flashcards");
    public string CancelText => _localization.T("Cancel", "Flashcards");
    public string SaveText => _localization.T("Save", "Flashcards");
    public string DeleteText => _localization.T("ReviewSettingsDelete", "Flashcards");
    public string RenameText => _localization.T("RenameDeck", "Flashcards");

    public string DeckCountLabel(int count) => count == 1
        ? _localization.T("ReviewSettingsDeckCountSingular", "Flashcards")
        : string.Format(CultureInfo.CurrentCulture, _localization.T("ReviewSettingsDeckCountFormat", "Flashcards"), count);

    public IRelayCommand<FlashcardPresetItemViewModel?> SelectPresetCommand { get; }
    public IRelayCommand CreatePresetCommand { get; }
    public IRelayCommand<FlashcardPresetItemViewModel?> BeginRenameCommand { get; }
    public IRelayCommand<FlashcardPresetItemViewModel?> CommitRenameCommand { get; }
    public IRelayCommand<FlashcardPresetItemViewModel?> CancelRenameCommand { get; }
    public IAsyncRelayCommand<FlashcardPresetItemViewModel?> DeletePresetCommand { get; }
    public IRelayCommand RestoreDefaultsCommand { get; }
    public IAsyncRelayCommand SaveCommand { get; }

    /// <summary>Raised after a successful Save (or Cancel) so the launcher can close the overlay.</summary>
    public event EventHandler? RequestClose;

    public async Task InitializeAsync(string? deckId, string? deckName, CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            _deckId = deckId;
            DeckName = deckName;

            await _presetService.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(true);
            var presets = await _presetService.ListPresetsAsync(cancellationToken).ConfigureAwait(true);

            Presets.Clear();
            _drafts.Clear();
            _persistedPresetIds.Clear();

            string? selectId = null;
            if (!string.IsNullOrEmpty(deckId))
            {
                var deck = await _libraryService.GetDeckAsync(deckId, cancellationToken).ConfigureAwait(true);
                _originalDeckPresetId = deck?.Header.PresetId;
                selectId = _originalDeckPresetId;
            }

            foreach (var preset in presets)
            {
                _persistedPresetIds.Add(preset.Id);
                _drafts[preset.Id] = FlashcardPresetDraft.FromPreset(preset);

                var count = await _presetService.CountDecksUsingAsync(preset.Id, cancellationToken).ConfigureAwait(true);
                var item = new FlashcardPresetItemViewModel(preset.Id, isNew: false)
                {
                    Name = preset.Name,
                    DeckCount = count,
                    DeckCountLabel = DeckCountLabel(count)
                };
                Presets.Add(item);
            }

            selectId ??= FlashcardPreset.StandardPresetId;
            var toSelect = Presets.FirstOrDefault(p => string.Equals(p.Id, selectId, StringComparison.Ordinal))
                           ?? Presets.FirstOrDefault(p => p.IsStandard)
                           ?? Presets.FirstOrDefault();
            SelectPreset(toSelect);
            RecomputeCanSave();
        }
        catch (Exception ex)
        {
            await _overlay.CreateDialogAsync(
                _localization.T("ReviewSettingsLoadErrorTitle", "Flashcards"),
                ex.Message).ConfigureAwait(true);
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void SelectPreset(FlashcardPresetItemViewModel? item)
    {
        if (item == null) return;

        // Commit the currently-edited draft's field values before switching away.
        CommitFieldsToDraft();

        foreach (var p in Presets)
            p.IsSelected = ReferenceEquals(p, item);
        SelectedPreset = item;
        OnPropertyChanged(nameof(EditingNoteText));

        if (!_drafts.TryGetValue(item.Id, out var draft))
            return;

        LoadFieldsFromDraft(draft);
        RecomputeCanSave();
    }

    private void LoadFieldsFromDraft(FlashcardPresetDraft draft)
    {
        NewPerDay = draft.NewPerDay;
        MaxReviewsPerDay = draft.MaxReviewsPerDay;
        SelectedAlgorithmOption = "FSRS-6";
        DesiredRetentionPercent = (int)Math.Round(draft.DesiredRetention * 100, MidpointRounding.AwayFromZero);
        LearningStepsText = FormatSteps(draft.LearningSteps);
        HasLearningStepsError = false;
        ShuffleOrder = draft.ShuffleOrder;
        BuryRelated = draft.BuryRelated;
        SelectedAutoRevealOption = AutoRevealOptions.FirstOrDefault(o => o.Value == draft.AutoReveal) ?? AutoRevealOptions[0];
    }

    /// <summary>Writes the currently-bound field values back into the currently-selected draft.</summary>
    private void CommitFieldsToDraft()
    {
        if (SelectedPreset == null) return;
        if (!_drafts.TryGetValue(SelectedPreset.Id, out var draft)) return;

        var parsedSteps = ParseLearningSteps(LearningStepsText, out var valid);
        if (!valid) return; // never persist an invalid draft value; the box already shows the error state

        var selectedAutoReveal = SelectedAutoRevealOption?.Value ?? FlashcardAutoReveal.Off;
        var changed =
            draft.NewPerDay != NewPerDay ||
            draft.MaxReviewsPerDay != MaxReviewsPerDay ||
            draft.DesiredRetention != DesiredRetentionPercent / 100.0 ||
            !draft.LearningSteps.SequenceEqual(parsedSteps) ||
            draft.ShuffleOrder != ShuffleOrder ||
            draft.BuryRelated != BuryRelated ||
            draft.AutoReveal != selectedAutoReveal;

        draft.NewPerDay = NewPerDay;
        draft.MaxReviewsPerDay = MaxReviewsPerDay;
        draft.DesiredRetention = DesiredRetentionPercent / 100.0;
        draft.LearningSteps = parsedSteps;
        draft.ShuffleOrder = ShuffleOrder;
        draft.BuryRelated = BuryRelated;
        draft.AutoReveal = selectedAutoReveal;

        if (changed)
            draft.IsDirty = true;
    }

    partial void OnNewPerDayChanged(int value) => OnFieldEdited();
    partial void OnMaxReviewsPerDayChanged(int value) => OnFieldEdited();
    partial void OnDesiredRetentionPercentChanged(int value)
    {
        OnPropertyChanged(nameof(DesiredRetentionLabel));
        OnFieldEdited();
    }
    partial void OnShuffleOrderChanged(bool value) => OnFieldEdited();
    partial void OnSelectedAutoRevealOptionChanged(FlashcardAutoRevealOption? value) => OnFieldEdited();

    partial void OnLearningStepsTextChanged(string value)
    {
        ParseLearningSteps(value, out var valid);
        HasLearningStepsError = !valid;
        OnFieldEdited();
    }

    private void OnFieldEdited()
    {
        CommitFieldsToDraft();
        RecomputeCanSave();
    }

    private void RecomputeCanSave()
    {
        var anyDirty = _drafts.Values.Any(d => d.IsDirty);
        var deckPresetChanged = !string.IsNullOrEmpty(_deckId)
            && SelectedPreset != null
            && !string.Equals(SelectedPreset.Id, _originalDeckPresetId, StringComparison.Ordinal);

        HasUnsavedChanges = anyDirty || deckPresetChanged;
        CanSave = HasUnsavedChanges && !HasLearningStepsError;
    }

    partial void OnHasLearningStepsErrorChanged(bool value) => RecomputeCanSave();

    private static string FormatSteps(IReadOnlyList<int> steps) =>
        string.Join(" ", steps.Select(s => string.Create(CultureInfo.InvariantCulture, $"{s}m")));

    /// <summary>
    /// Parses "1m 10m", "1, 10", "1m·10m" etc. into positive-minute integers. Valid only when there
    /// are 1-5 all-positive tokens; otherwise returns the last-known-good/empty list and valid=false.
    /// </summary>
    private static IReadOnlyList<int> ParseLearningSteps(string text, out bool valid)
    {
        var tokens = LearningStepsSplitPattern.Split(text.Trim()).Where(t => t.Length > 0).ToArray();
        if (tokens.Length is < 1 or > 5)
        {
            valid = false;
            return Array.Empty<int>();
        }

        var result = new List<int>(tokens.Length);
        foreach (var token in tokens)
        {
            var match = LearningStepsTokenPattern.Match(token);
            if (!match.Success)
            {
                valid = false;
                return Array.Empty<int>();
            }

            if (!int.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var minutes) || minutes <= 0)
            {
                valid = false;
                return Array.Empty<int>();
            }

            result.Add(minutes);
        }

        valid = true;
        return result;
    }

    private void CreatePreset()
    {
        CommitFieldsToDraft();

        var now = DateTimeOffset.UtcNow;
        var standard = FlashcardPreset.CreateStandard(now);
        var baseName = _localization.T("ReviewSettingsNewPreset", "Flashcards");
        var name = MakeUniqueName(baseName);

        var id = Guid.NewGuid().ToString();
        var draft = new FlashcardPresetDraft
        {
            Id = id,
            Name = name,
            NewPerDay = standard.NewPerDay,
            MaxReviewsPerDay = standard.MaxReviewsPerDay,
            Algorithm = standard.Algorithm,
            DesiredRetention = standard.DesiredRetention,
            LearningSteps = standard.LearningSteps,
            RelearnSteps = standard.RelearnSteps,
            ShuffleOrder = standard.ShuffleOrder,
            BuryRelated = standard.BuryRelated,
            AutoReveal = standard.AutoReveal,
            Weights = standard.Weights,
            CreatedAt = now,
            UpdatedAt = now,
            IsDirty = true
        };
        _drafts[id] = draft;

        var item = new FlashcardPresetItemViewModel(id, isNew: true)
        {
            Name = name,
            DeckCount = 0,
            DeckCountLabel = DeckCountLabel(0)
        };
        Presets.Add(item);
        SelectPreset(item);
        BeginRename(item);
        RecomputeCanSave();
    }

    private string MakeUniqueName(string baseName)
    {
        var existing = new HashSet<string>(Presets.Select(p => p.Name), StringComparer.OrdinalIgnoreCase);
        if (!existing.Contains(baseName))
            return baseName;

        var i = 2;
        while (existing.Contains(string.Create(CultureInfo.InvariantCulture, $"{baseName} {i}")))
            i++;
        return string.Create(CultureInfo.InvariantCulture, $"{baseName} {i}");
    }

    private void BeginRename(FlashcardPresetItemViewModel? item)
    {
        if (item == null) return;
        item.RenameText = item.Name;
        item.IsRenaming = true;
    }

    private void CommitRename(FlashcardPresetItemViewModel? item)
    {
        if (item == null) return;
        var trimmed = item.RenameText.Trim();
        if (trimmed.Length > 0 && !string.Equals(trimmed, item.Name, StringComparison.Ordinal))
        {
            item.Name = trimmed;
            if (_drafts.TryGetValue(item.Id, out var draft))
            {
                draft.Name = trimmed;
                draft.IsDirty = true;
            }
            if (ReferenceEquals(SelectedPreset, item))
                OnPropertyChanged(nameof(EditingNoteText));
            RecomputeCanSave();
        }
        item.IsRenaming = false;
    }

    private void CancelRename(FlashcardPresetItemViewModel? item)
    {
        if (item == null) return;
        item.IsRenaming = false;
    }

    private async Task DeletePresetAsync(FlashcardPresetItemViewModel? item, CancellationToken cancellationToken)
    {
        if (item == null || !item.CanDelete) return;

        if (item.IsNew)
        {
            // Never persisted: just drop the local draft.
            _drafts.Remove(item.Id);
            RemovePresetItem(item);
            return;
        }

        var confirmLabel = _localization.T("ReviewSettingsDelete", "Flashcards");
        var cancelLabel = _localization.T("Cancel", "Flashcards");
        var confirm = await _overlay.CreateDialogAsync(
            _localization.T("ReviewSettingsDeleteConfirmTitle", "Flashcards"),
            string.Format(CultureInfo.CurrentCulture, _localization.T("ReviewSettingsDeleteConfirmMessage", "Flashcards"), item.Name),
            confirmLabel,
            cancelLabel,
            severity: DialogSeverity.Destructive).ConfigureAwait(true);
        if (!string.Equals(confirm, confirmLabel, StringComparison.Ordinal))
            return;

        try
        {
            var deleted = await _presetService.DeletePresetAsync(item.Id, cancellationToken).ConfigureAwait(true);
            if (!deleted)
            {
                await _overlay.CreateDialogAsync(
                    _localization.T("ReviewSettingsDeleteBlockedTitle", "Flashcards"),
                    _localization.T("ReviewSettingsDeleteBlockedMessage", "Flashcards")).ConfigureAwait(true);
                return;
            }

            _drafts.Remove(item.Id);
            _persistedPresetIds.Remove(item.Id);
            RemovePresetItem(item);
        }
        catch (Exception ex)
        {
            await _overlay.CreateDialogAsync(
                _localization.T("ReviewSettingsErrorTitle", "Flashcards"),
                ex.Message).ConfigureAwait(true);
        }
    }

    private void RemovePresetItem(FlashcardPresetItemViewModel item)
    {
        var index = Presets.IndexOf(item);
        Presets.Remove(item);

        if (!ReferenceEquals(SelectedPreset, item))
        {
            RecomputeCanSave();
            return;
        }

        var next = Presets.Count == 0
            ? null
            : Presets[Math.Min(index, Presets.Count - 1)];
        SelectedPreset = null;
        SelectPreset(next);
        RecomputeCanSave();
    }

    private void RestoreDefaults()
    {
        if (SelectedPreset == null) return;
        if (!_drafts.TryGetValue(SelectedPreset.Id, out var draft)) return;

        draft.ResetValuesToStandard(DateTimeOffset.UtcNow);
        draft.IsDirty = true;
        LoadFieldsFromDraft(draft);
        RecomputeCanSave();
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        CommitFieldsToDraft();
        if (!CanSave) return;

        try
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var draft in _drafts.Values.Where(d => d.IsDirty))
            {
                var saved = await _presetService.SavePresetAsync(draft.ToPreset(now), cancellationToken).ConfigureAwait(true);
                draft.CreatedAt = saved.CreatedAt;
                draft.UpdatedAt = saved.UpdatedAt;
                draft.IsDirty = false;
                _persistedPresetIds.Add(draft.Id);
            }

            if (!string.IsNullOrEmpty(_deckId) && SelectedPreset != null &&
                !string.Equals(SelectedPreset.Id, _originalDeckPresetId, StringComparison.Ordinal))
            {
                await _presetService.AssignDeckPresetAsync(_deckId, SelectedPreset.Id, cancellationToken).ConfigureAwait(true);
                _originalDeckPresetId = SelectedPreset.Id;
            }

            RecomputeCanSave();
            RequestClose?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception ex)
        {
            await _overlay.CreateDialogAsync(
                _localization.T("ReviewSettingsSaveErrorTitle", "Flashcards"),
                ex.Message).ConfigureAwait(true);
        }
    }

    /// <summary>Cancel/Escape/outside-click: nothing is persisted regardless of draft state.</summary>
    public void Cancel() => RequestClose?.Invoke(this, EventArgs.Empty);
}
