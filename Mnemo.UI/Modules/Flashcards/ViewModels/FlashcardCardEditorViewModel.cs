using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Flashcards;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.ViewModels;

/// <summary>Which side of the card a format-bar action or attachment applies to.</summary>
public enum FlashcardEditorSide
{
    Front,
    Back
}

/// <summary>
/// A deck option in the editor's deck picker, showing its "Folder / Deck" path so the user can
/// re-home a card (add mode: choose target; edit mode: move the card by switching deck).
/// </summary>
public sealed record FlashcardDeckPickerItem(string DeckId, string DeckName, string? FolderName)
{
    /// <summary>"Folder / Deck" (or just "Deck" at library root).</summary>
    public string PathLabel => string.IsNullOrEmpty(FolderName)
        ? DeckName
        : string.Create(CultureInfo.CurrentCulture, $"{FolderName} / {DeckName}");
}

/// <summary>
/// One attached image on a card side, as shown in the editor: thumbnail source + filename/size and
/// the per-attachment Replace/Remove commands. Backed by a <see cref="FlashcardAttachment"/> row.
/// </summary>
public partial class FlashcardAttachmentItemViewModel : ObservableObject
{
    private readonly FlashcardCardEditorViewModel _owner;

    public FlashcardAttachmentItemViewModel(FlashcardCardEditorViewModel owner, FlashcardAttachment attachment)
    {
        _owner = owner;
        Attachment = attachment;
    }

    /// <summary>The underlying persisted attachment (id, side, file path, name, size, caption).</summary>
    public FlashcardAttachment Attachment { get; private set; }

    public FlashcardEditorSide Side =>
        string.Equals(Attachment.Side, FlashcardAttachment.BackSide, StringComparison.OrdinalIgnoreCase)
            ? FlashcardEditorSide.Back
            : FlashcardEditorSide.Front;

    /// <summary>Absolute path to the stored image file, used as the thumbnail source.</summary>
    public string FilePath => Attachment.FilePath;

    public string DisplayName => Attachment.DisplayName;

    /// <summary>"diagram.png · 24 KB": filename and size for the figure caption row.</summary>
    public string SizeLabel
    {
        get
        {
            var kb = Math.Max(1, (int)Math.Round(Attachment.SizeBytes / 1024.0, MidpointRounding.AwayFromZero));
            return string.Create(CultureInfo.CurrentCulture, $"{DisplayName} · {kb} KB");
        }
    }

    /// <summary>Swaps the underlying attachment (e.g. after a Replace), keeping this item's position.</summary>
    public void UpdateAttachment(FlashcardAttachment attachment)
    {
        Attachment = attachment;
        OnPropertyChanged(nameof(FilePath));
        OnPropertyChanged(nameof(DisplayName));
        OnPropertyChanged(nameof(SizeLabel));
    }

    [RelayCommand]
    private Task ReplaceAsync() => _owner.ReplaceAttachmentAsync(this);

    [RelayCommand]
    private Task RemoveAsync() => _owner.RemoveAttachmentAsync(this);
}

/// <summary>
/// A tag chip in the editor, with its remove command.
/// </summary>
public partial class FlashcardTagChipViewModel : ObservableObject
{
    private readonly Action<FlashcardTagChipViewModel> _remove;

    public FlashcardTagChipViewModel(string text, Action<FlashcardTagChipViewModel> remove)
    {
        Text = text;
        _remove = remove;
    }

    public string Text { get; }

    [RelayCommand]
    private void Remove() => _remove(this);
}

/// <summary>
/// VM for the single add/edit card dialog. One dialog serves both modes: add drafts a new card
/// targeting a deck and clears for the next after each save (session counter increments); edit loads a
/// card, saves in place, and closes. The canonical body is the plaintext/markdown Front/Back; images
/// attach as framed figures under the owning side (up to 3 per side) rather than inline tokens.
/// </summary>
public partial class FlashcardCardEditorViewModel : ViewModelBase
{
    /// <summary>Matches the system cloze grammar <c>{{cN::…}}</c> parsed everywhere else (practice, deck view, Anki).</summary>
    private static readonly Regex ClozePattern = new(@"\{\{c(\d+)::", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Image file extensions accepted by the picker, drop and clipboard paste paths.</summary>
    public static readonly IReadOnlyList<string> ImageExtensions =
        new[] { ".png", ".jpg", ".jpeg", ".gif", ".webp" };

    private readonly IFlashcardCardService _cardService;
    private readonly IFlashcardLibraryService _libraryService;
    private readonly IImageAssetService _imageAssets;
    private readonly IOverlayService _overlay;
    private readonly ILocalizationService _localization;

    private string? _editingCardId;
    private FlashcardSourceInfo? _sourceInfo;

    public FlashcardCardEditorViewModel(
        IFlashcardCardService cardService,
        IFlashcardLibraryService libraryService,
        IImageAssetService imageAssets,
        IOverlayService overlay,
        ILocalizationService localization)
    {
        _cardService = cardService;
        _libraryService = libraryService;
        _imageAssets = imageAssets;
        _overlay = overlay;
        _localization = localization;
    }

    // --- Mode ---------------------------------------------------------------------------------

    /// <summary>True in edit mode (loads an existing card, primary = Save, closes on save).</summary>
    [ObservableProperty]
    private bool _isEditMode;

    public bool IsAddMode => !IsEditMode;

    [ObservableProperty]
    private bool _isLoading = true;

    // --- Deck picker --------------------------------------------------------------------------

    public ObservableCollection<FlashcardDeckPickerItem> Decks { get; } = new();

    [ObservableProperty]
    private FlashcardDeckPickerItem? _selectedDeck;

    // --- Type toggle --------------------------------------------------------------------------

    [ObservableProperty]
    private FlashcardType _cardType = FlashcardType.Classic;

    public bool IsClassic => CardType == FlashcardType.Classic;
    public bool IsCloze => CardType == FlashcardType.Cloze;

    // --- Body ---------------------------------------------------------------------------------

    [ObservableProperty]
    private string _front = string.Empty;

    [ObservableProperty]
    private string _back = string.Empty;

    /// <summary>Which side currently owns focus; drives the quiet format bar + accent border.</summary>
    [ObservableProperty]
    private FlashcardEditorSide? _focusedSide;

    public bool IsFrontFocused => FocusedSide == FlashcardEditorSide.Front;
    public bool IsBackFocused => FocusedSide == FlashcardEditorSide.Back;

    public ObservableCollection<FlashcardAttachmentItemViewModel> FrontAttachments { get; } = new();
    public ObservableCollection<FlashcardAttachmentItemViewModel> BackAttachments { get; } = new();

    public bool CanAddFrontAttachment => FrontAttachments.Count < IFlashcardCardService.MaxAttachmentsPerSide;
    public bool CanAddBackAttachment => BackAttachments.Count < IFlashcardCardService.MaxAttachmentsPerSide;

    // --- Tags ---------------------------------------------------------------------------------

    public ObservableCollection<FlashcardTagChipViewModel> Tags { get; } = new();

    [ObservableProperty]
    private bool _isAddingTag;

    [ObservableProperty]
    private string _newTagText = string.Empty;

    // --- Footer / validation ------------------------------------------------------------------

    [ObservableProperty]
    private int _sessionAddedCount;

    [ObservableProperty]
    private bool _canSave;

    public string SessionAddedText => string.Format(
        CultureInfo.CurrentCulture, _localization.T("CardEditorSessionAddedFormat", "Flashcards"), SessionAddedCount);

    // --- Localized strings --------------------------------------------------------------------

    public string TitleText => IsEditMode
        ? _localization.T("CardEditorTitleEdit", "Flashcards")
        : _localization.T("CardEditorTitleNew", "Flashcards");

    public string FrontLabel => _localization.T("FieldFront", "Flashcards");
    public string BackLabel => _localization.T("FieldBack", "Flashcards");
    public string ClassicLabel => _localization.T("TypeClassic", "Flashcards");
    public string ClozeLabel => _localization.T("TypeCloze", "Flashcards");
    public string CloseText => _localization.T("CloseCard", "Flashcards");
    public string AttachmentsHint => _localization.T("CardEditorAttachmentsHint", "Flashcards");
    public string AttachmentFigureHint => _localization.T("CardEditorFigureHint", "Flashcards");
    public string ReplaceText => _localization.T("CardEditorReplace", "Flashcards");
    public string RemoveText => _localization.T("Remove", "Flashcards");
    public string TagsLabel => _localization.T("TagsLabel", "Flashcards");
    public string AddTagText => _localization.T("CardEditorAddTag", "Flashcards");
    public string TagPlaceholder => _localization.T("TagAddPlaceholder", "Flashcards");
    public string BoldTooltip => _localization.T("CardEditorBold", "Flashcards");
    public string ItalicTooltip => _localization.T("CardEditorItalic", "Flashcards");
    public string ClozeWrapTooltip => _localization.T("CardEditorClozeWrap", "Flashcards");
    public string ImageTooltip => _localization.T("InsertImage", "Flashcards");

    public string PrimaryText => IsEditMode
        ? _localization.T("Save", "Flashcards")
        : _localization.T("AddCard", "Flashcards");

    /// <summary>Platform-appropriate hint for the add-mode primary button (⌘⏎ on macOS, Ctrl+⏎ elsewhere).</summary>
    public string PrimaryShortcutHint => OperatingSystem.IsMacOS() ? "⌘⏎" : "Ctrl+⏎";

    // --- Events -------------------------------------------------------------------------------

    /// <summary>Raised when the dialog should close (Close, Escape, outside-click, or edit-mode save).</summary>
    public event EventHandler? RequestClose;

    /// <summary>Raised so the view can move focus back to the front field after a save-and-new clear.</summary>
    public event EventHandler? RequestFocusFront;

    /// <summary>Raised so the view can begin editing the inline "add tag" TextBox.</summary>
    public event EventHandler? RequestFocusTagInput;

    // --- Commands -----------------------------------------------------------------------------

    /// <summary>Add mode: save-and-new (clears, keeps deck/type/tags). Edit mode: save-and-close.</summary>
    [RelayCommand]
    private Task PrimaryAsync(CancellationToken cancellationToken) => SaveAsync(cancellationToken);

    [RelayCommand]
    private void Close() => RequestClose?.Invoke(this, EventArgs.Empty);

    [RelayCommand]
    private void SetClassic() => CardType = FlashcardType.Classic;

    [RelayCommand]
    private void SetCloze() => CardType = FlashcardType.Cloze;

    [RelayCommand]
    private void BeginAddTag()
    {
        NewTagText = string.Empty;
        IsAddingTag = true;
        RequestFocusTagInput?.Invoke(this, EventArgs.Empty);
    }

    [RelayCommand]
    private void CommitTag()
    {
        var trimmed = NewTagText.Trim();
        if (trimmed.Length > 0 && !Tags.Any(t => string.Equals(t.Text, trimmed, StringComparison.OrdinalIgnoreCase)))
            Tags.Add(new FlashcardTagChipViewModel(trimmed, RemoveTag));
        NewTagText = string.Empty;
        IsAddingTag = false;
    }

    [RelayCommand]
    private void CancelAddTag()
    {
        NewTagText = string.Empty;
        IsAddingTag = false;
    }

    private void RemoveTag(FlashcardTagChipViewModel chip) => Tags.Remove(chip);

    // --- Initialization -----------------------------------------------------------------------

    /// <summary>Add mode: draft a new card targeting <paramref name="deckId"/> (picker changeable).</summary>
    public async Task InitializeForAddAsync(string deckId, CancellationToken cancellationToken = default)
    {
        IsEditMode = false;
        _editingCardId = null;
        await LoadDecksAsync(deckId, cancellationToken).ConfigureAwait(true);
        IsLoading = false;
        RecomputeCanSave();
    }

    /// <summary>Edit mode: load <paramref name="cardId"/>, primary = Save, closes on save.</summary>
    public async Task InitializeForEditAsync(string cardId, CancellationToken cancellationToken = default)
    {
        IsEditMode = true;
        _editingCardId = cardId;
        try
        {
            var card = await _cardService.GetCardAsync(cardId, cancellationToken).ConfigureAwait(true);
            if (card is null)
            {
                await _overlay.CreateDialogAsync(
                    _localization.T("CardEditorLoadErrorTitle", "Flashcards"),
                    _localization.T("CardEditorLoadErrorMessage", "Flashcards")).ConfigureAwait(true);
                RequestClose?.Invoke(this, EventArgs.Empty);
                return;
            }

            await LoadDecksAsync(card.DeckId, cancellationToken).ConfigureAwait(true);

            CardType = card.Type;
            Front = card.Front;
            Back = card.Back;
            _sourceInfo = card.SourceInfo;

            Tags.Clear();
            foreach (var tag in card.Tags)
                Tags.Add(new FlashcardTagChipViewModel(tag, RemoveTag));

            LoadAttachments(card.Attachments);
        }
        finally
        {
            IsLoading = false;
            RecomputeCanSave();
        }
    }

    private async Task LoadDecksAsync(string? selectDeckId, CancellationToken cancellationToken)
    {
        var summaries = await _libraryService.ListDecksAsync(cancellationToken).ConfigureAwait(true);
        var folders = await _libraryService.ListFoldersAsync(cancellationToken).ConfigureAwait(true);
        var folderNames = folders.ToDictionary(f => f.Id, f => f.Name, StringComparer.Ordinal);

        Decks.Clear();
        foreach (var summary in summaries
                     .OrderBy(s => s.Header.FolderId is null ? 0 : 1)
                     .ThenBy(s => s.Header.FolderId is null ? string.Empty : folderNames.GetValueOrDefault(s.Header.FolderId, string.Empty), StringComparer.CurrentCultureIgnoreCase)
                     .ThenBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            var folderName = summary.Header.FolderId is { } fid ? folderNames.GetValueOrDefault(fid) : null;
            Decks.Add(new FlashcardDeckPickerItem(summary.Id, summary.Name, folderName));
        }

        SelectedDeck = Decks.FirstOrDefault(d => string.Equals(d.DeckId, selectDeckId, StringComparison.Ordinal))
                       ?? Decks.FirstOrDefault();
    }

    private void LoadAttachments(IReadOnlyList<FlashcardAttachment> attachments)
    {
        FrontAttachments.Clear();
        BackAttachments.Clear();
        foreach (var attachment in attachments)
        {
            var item = new FlashcardAttachmentItemViewModel(this, attachment);
            (item.Side == FlashcardEditorSide.Back ? BackAttachments : FrontAttachments).Add(item);
        }
        NotifyAttachmentCapsChanged();
    }

    // --- Format bar ---------------------------------------------------------------------------

    /// <summary>Wraps the current selection on a side with markdown <c>**bold**</c>.</summary>
    public (string NewText, int Caret) WrapBold(FlashcardEditorSide side, int selectionStart, int selectionEnd) =>
        WrapWithMarker(SideText(side), selectionStart, selectionEnd, "**");

    /// <summary>Wraps the current selection on a side with markdown <c>*italic*</c>.</summary>
    public (string NewText, int Caret) WrapItalic(FlashcardEditorSide side, int selectionStart, int selectionEnd) =>
        WrapWithMarker(SideText(side), selectionStart, selectionEnd, "*");

    /// <summary>Wraps the selection in the next cloze ordinal using the system grammar <c>{{cN::…}}</c>.</summary>
    public (string NewText, int Caret) WrapCloze(FlashcardEditorSide side, int selectionStart, int selectionEnd)
    {
        var text = SideText(side);
        var start = Math.Clamp(selectionStart, 0, text.Length);
        var end = Math.Clamp(selectionEnd, 0, text.Length);
        if (end < start)
            (start, end) = (end, start);

        var n = FlashcardClozeOrdinal.ComputeNext(text);
        var selected = end > start ? text.Substring(start, end - start) : string.Empty;
        var wrapped = selected.Length > 0
            ? $"{{{{c{n}::{selected}}}}}"
            : $"{{{{c{n}::}}}}";

        var newText = text[..start] + wrapped + text[end..];
        var caret = selected.Length > 0
            ? start + wrapped.Length
            : start + wrapped.IndexOf("::", StringComparison.Ordinal) + 2;
        return (newText, caret);
    }

    private static (string NewText, int Caret) WrapWithMarker(string text, int selectionStart, int selectionEnd, string marker)
    {
        var start = Math.Clamp(selectionStart, 0, text.Length);
        var end = Math.Clamp(selectionEnd, 0, text.Length);
        if (end < start)
            (start, end) = (end, start);

        var selected = end > start ? text.Substring(start, end - start) : string.Empty;
        var wrapped = $"{marker}{selected}{marker}";
        var newText = text[..start] + wrapped + text[end..];
        var caret = selected.Length > 0
            ? start + wrapped.Length
            : start + marker.Length;
        return (newText, caret);
    }

    private string SideText(FlashcardEditorSide side) => side == FlashcardEditorSide.Back ? Back : Front;

    public void SetSideText(FlashcardEditorSide side, string value)
    {
        if (side == FlashcardEditorSide.Back)
            Back = value;
        else
            Front = value;
    }

    // --- Attachments --------------------------------------------------------------------------

    /// <summary>
    /// Copies <paramref name="sourcePath"/> into app data and attaches it to <paramref name="side"/>
    /// (capped at 3). Returns false when the side is full or the copy failed.
    /// </summary>
    public async Task<bool> AttachImageAsync(FlashcardEditorSide side, string sourcePath, CancellationToken cancellationToken = default)
    {
        var collection = side == FlashcardEditorSide.Back ? BackAttachments : FrontAttachments;
        if (collection.Count >= IFlashcardCardService.MaxAttachmentsPerSide)
            return false;
        if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
            return false;
        if (!ImageExtensions.Contains(Path.GetExtension(sourcePath), StringComparer.OrdinalIgnoreCase))
            return false;

        var attachmentId = Guid.NewGuid().ToString("N");
        var copied = await _imageAssets.ImportAndCopyAsync(sourcePath, attachmentId, cancellationToken).ConfigureAwait(true);
        if (!copied.IsSuccess || string.IsNullOrWhiteSpace(copied.Value))
            return false;

        var displayName = Path.GetFileName(sourcePath);
        long sizeBytes = 0;
        try { sizeBytes = new FileInfo(copied.Value!).Length; } catch (IOException) { }

        var attachment = new FlashcardAttachment(
            attachmentId,
            side == FlashcardEditorSide.Back ? FlashcardAttachment.BackSide : FlashcardAttachment.FrontSide,
            copied.Value!,
            displayName,
            sizeBytes,
            Caption: null);

        collection.Add(new FlashcardAttachmentItemViewModel(this, attachment));
        NotifyAttachmentCapsChanged();
        return true;
    }

    internal async Task ReplaceAttachmentAsync(FlashcardAttachmentItemViewModel item)
    {
        var sourcePath = await PickImageFileAsync().ConfigureAwait(true);
        if (sourcePath is null)
            return;

        var attachmentId = Guid.NewGuid().ToString("N");
        var copied = await _imageAssets.ImportAndCopyAsync(sourcePath, attachmentId).ConfigureAwait(true);
        if (!copied.IsSuccess || string.IsNullOrWhiteSpace(copied.Value))
            return;

        var oldPath = item.Attachment.FilePath;
        long sizeBytes = 0;
        try { sizeBytes = new FileInfo(copied.Value!).Length; } catch (IOException) { }

        item.UpdateAttachment(item.Attachment with
        {
            Id = attachmentId,
            FilePath = copied.Value!,
            DisplayName = Path.GetFileName(sourcePath),
            SizeBytes = sizeBytes
        });

        // Attachments are per-card copies (unique id filename), so the swapped-out file is orphaned.
        await _imageAssets.DeleteStoredFileAsync(oldPath).ConfigureAwait(true);
    }

    internal async Task RemoveAttachmentAsync(FlashcardAttachmentItemViewModel item)
    {
        if (item.Side == FlashcardEditorSide.Back)
            BackAttachments.Remove(item);
        else
            FrontAttachments.Remove(item);
        NotifyAttachmentCapsChanged();

        // Per-card copy → delete the orphaned file.
        await _imageAssets.DeleteStoredFileAsync(item.Attachment.FilePath).ConfigureAwait(true);
    }

    /// <summary>Opens the file picker so the view can attach the chosen image to a side.</summary>
    public Func<Task<string?>>? ImageFilePicker { get; set; }

    private Task<string?> PickImageFileAsync() =>
        ImageFilePicker?.Invoke() ?? Task.FromResult<string?>(null);

    private void NotifyAttachmentCapsChanged()
    {
        OnPropertyChanged(nameof(CanAddFrontAttachment));
        OnPropertyChanged(nameof(CanAddBackAttachment));
        RecomputeCanSave();
    }

    // --- Property change hooks ----------------------------------------------------------------

    partial void OnCardTypeChanged(FlashcardType value)
    {
        OnPropertyChanged(nameof(IsClassic));
        OnPropertyChanged(nameof(IsCloze));
        RecomputeCanSave();
    }

    partial void OnFrontChanged(string value) => RecomputeCanSave();
    partial void OnBackChanged(string value) => RecomputeCanSave();
    partial void OnSelectedDeckChanged(FlashcardDeckPickerItem? value) => RecomputeCanSave();
    partial void OnIsEditModeChanged(bool value)
    {
        OnPropertyChanged(nameof(IsAddMode));
        OnPropertyChanged(nameof(TitleText));
        OnPropertyChanged(nameof(PrimaryText));
    }
    partial void OnSessionAddedCountChanged(int value) => OnPropertyChanged(nameof(SessionAddedText));

    partial void OnFocusedSideChanged(FlashcardEditorSide? value)
    {
        OnPropertyChanged(nameof(IsFrontFocused));
        OnPropertyChanged(nameof(IsBackFocused));
    }

    private void RecomputeCanSave()
    {
        var hasFront = !string.IsNullOrWhiteSpace(Front);
        var hasBack = !string.IsNullOrWhiteSpace(Back);
        var clozeOk = CardType != FlashcardType.Cloze || ClozePattern.IsMatch(Front);
        CanSave = SelectedDeck != null && hasFront && hasBack && clozeOk;
    }

    // --- Persistence --------------------------------------------------------------------------

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        RecomputeCanSave();
        if (!CanSave || SelectedDeck is null)
            return;

        try
        {
            if (IsEditMode)
            {
                await SaveEditAsync(cancellationToken).ConfigureAwait(true);
                RequestClose?.Invoke(this, EventArgs.Empty);
            }
            else
            {
                await SaveNewAsync(cancellationToken).ConfigureAwait(true);
                ClearForNextCard();
            }
        }
        catch (Exception ex)
        {
            await _overlay.CreateDialogAsync(
                _localization.T("CardEditorSaveErrorTitle", "Flashcards"),
                ex.Message).ConfigureAwait(true);
        }
    }

    private async Task SaveNewAsync(CancellationToken cancellationToken)
    {
        var draft = new FlashcardCardDraft(
            DeckId: SelectedDeck!.DeckId,
            Type: CardType,
            Front: Front.Trim(),
            Back: Back.Trim(),
            Tags: Tags.Select(t => t.Text).ToArray(),
            Attachments: CollectAttachments(),
            SourceInfo: _sourceInfo);

        await _cardService.CreateCardAsync(draft, cancellationToken).ConfigureAwait(true);
        SessionAddedCount++;
    }

    private async Task SaveEditAsync(CancellationToken cancellationToken)
    {
        var existing = await _cardService.GetCardAsync(_editingCardId!, cancellationToken).ConfigureAwait(true);
        if (existing is null)
            return;

        // A changed deck is a move: UpdateCardAsync persists DeckId, re-homing the card.
        var updated = existing with
        {
            DeckId = SelectedDeck!.DeckId,
            Type = CardType,
            Front = Front.Trim(),
            Back = Back.Trim(),
            Tags = Tags.Select(t => t.Text).ToArray(),
            Attachments = CollectAttachments(),
            // Canonical text changed; rich blocks are derived and regenerated on render.
            FrontBlocks = null,
            BackBlocks = null
        };

        await _cardService.UpdateCardAsync(updated, cancellationToken).ConfigureAwait(true);
    }

    private IReadOnlyList<FlashcardAttachment> CollectAttachments()
    {
        if (FrontAttachments.Count == 0 && BackAttachments.Count == 0)
            return Array.Empty<FlashcardAttachment>();
        return FrontAttachments.Concat(BackAttachments).Select(a => a.Attachment).ToArray();
    }

    private void ClearForNextCard()
    {
        // Keep deck, type and tags; clear body + attachments for the next card.
        Front = string.Empty;
        Back = string.Empty;
        FrontAttachments.Clear();
        BackAttachments.Clear();
        NotifyAttachmentCapsChanged();
        RecomputeCanSave();
        RequestFocusFront?.Invoke(this, EventArgs.Empty);
    }
}
