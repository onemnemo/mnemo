using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using Avalonia.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.History;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Input;
using Mnemo.UI.Modules.Notes.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Notes.ViewModels;

public partial class NotesViewModel : ViewModelBase, INavigationAware
{
    private string? _pendingOpenNoteIdAfterLoad;
    private bool _sidebarStateLoaded;

    private readonly NotesLibrarySession _library;
    private readonly NotesEditorSession _editor;
    private readonly NotesTreeMutator _treeMutator;
    private readonly NotesDocumentMutator _documentMutator;
    private readonly NotesEditorHistory _history;
    private readonly INoteService _noteService;
    private readonly INoteFolderService _folderService;
    private readonly ISettingsService _settingsService;
    private readonly ILocalizationService _localizationService;
    private readonly IDateDisplayService _dateDisplayService;

    [ObservableProperty]
    private Note? _selectedNote;

    [ObservableProperty]
    private string _selectedNoteTitle = string.Empty;

    [ObservableProperty]
    private NoteTreeItemViewModel? _selectedTreeItem;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private string _createdText = string.Empty;

    [ObservableProperty]
    private string _modifiedText = string.Empty;

    [ObservableProperty]
    private bool _isFavorite;

    [ObservableProperty]
    private int _deletedCount;

    public NoteBreadcrumbViewModel NoteBreadcrumb { get; }
    public NotesEditorSettings EditorSettings { get; } = new();

    public bool CanUndo => _history.CanUndo;
    public bool CanRedo => _history.CanRedo;
    public IHistoryManager EditorHistory => _history.Manager;

    public ObservableCollection<NoteTreeItemViewModel> RootTreeItems => _library.RootTreeItems;
    public ObservableCollection<Note> Notes => _library.Notes;
    public ObservableCollection<NoteTreeItemViewModel> FavouriteNotes => _library.FavouriteNotes;
    public ObservableCollection<NoteTreeItemViewModel> AllNotesTreeItems => _library.AllNotesTreeItems;
    public ObservableCollection<NoteTreeItemViewModel> FlattenedTreeItems => _library.FlattenedTreeItems;

    public double EditorMaxWidth
    {
        get => EditorSettings.EditorMaxWidth;
        set => EditorSettings.EditorMaxWidth = value;
    }

    public bool IsSidebarOpen
    {
        get => EditorSettings.IsSidebarOpen;
        set => EditorSettings.IsSidebarOpen = value;
    }

    public const string NoteTreeItemDragKey = NotesEditorConstants.NoteTreeItemDragKey;

    public static readonly DataFormat<NoteTreeItemViewModel> NoteTreeItemDragDataFormat =
        AvaloniaDataFormats.CreateApplicationFormat<NoteTreeItemViewModel>(NoteTreeItemDragKey);

    public NotesViewModel(
        NotesLibrarySession library,
        NotesEditorSession editor,
        NotesTreeMutator treeMutator,
        NotesDocumentMutator documentMutator,
        NotesEditorHistory history,
        INoteService noteService,
        INoteFolderService folderService,
        ISettingsService settingsService,
        ILocalizationService localizationService,
        IDateDisplayService dateDisplayService)
    {
        _library = library;
        _editor = editor;
        _treeMutator = treeMutator;
        _documentMutator = documentMutator;
        _history = history;
        _noteService = noteService;
        _folderService = folderService;
        _settingsService = settingsService;
        _localizationService = localizationService;
        _dateDisplayService = dateDisplayService;

        NoteBreadcrumb = new NoteBreadcrumbViewModel(() => Notes, folderService, NavigateToNoteById);

        _history.StateChanged += () =>
        {
            OnPropertyChanged(nameof(CanUndo));
            OnPropertyChanged(nameof(CanRedo));
        };

        _settingsService.SettingChanged += OnSettingChanged;
        EditorSettings.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(NotesEditorSettings.EditorMaxWidth))
                OnPropertyChanged(nameof(EditorMaxWidth));
            if (e.PropertyName == nameof(NotesEditorSettings.IsSidebarOpen))
            {
                OnPropertyChanged(nameof(IsSidebarOpen));
                if (_sidebarStateLoaded)
                    _ = _settingsService.SetAsync(NotesEditorConstants.NotesSidebarOpenKey, EditorSettings.IsSidebarOpen);
            }
        };
    }

    private void OnSettingChanged(object? sender, string key)
    {
        if (key == NotesEditorConstants.EditorWidthKey)
            _ = UpdateEditorWidthAsync();
    }

    [RelayCommand]
    private async Task LoadNotesAsync()
    {
        IsLoading = true;
        try
        {
            await UpdateEditorWidthAsync();
            var folders = (await _folderService.GetAllFoldersAsync()).ToList();
            var notes = (await _noteService.GetAllNotesAsync()).ToList();

            _library.SetFolders(folders);
            _library.SetNotes(notes);

            await _library.LoadExpandedFolderIdsFromSettingsAsync();
            await _library.BuildTreeAsync(folders, notes);
            _library.RefreshAllNotesFlatList(notes);
            _library.RefreshFavouriteNotes();

            string? noteIdToSelect = null;
            if (!string.IsNullOrWhiteSpace(_pendingOpenNoteIdAfterLoad))
            {
                noteIdToSelect = _pendingOpenNoteIdAfterLoad.Trim();
                _pendingOpenNoteIdAfterLoad = null;
            }
            else
            {
                noteIdToSelect = await _settingsService.GetAsync<string?>(NotesEditorConstants.LastOpenNoteIdKey, null);
            }

            if (!string.IsNullOrEmpty(noteIdToSelect))
            {
                var matchingItem = NotesLibrarySession.FindTreeItemByNoteId(RootTreeItems, noteIdToSelect);
                if (matchingItem == null)
                    matchingItem = FavouriteNotes.FirstOrDefault(i => i.Note?.NoteId == noteIdToSelect);
                if (matchingItem == null)
                    matchingItem = AllNotesTreeItems.FirstOrDefault(i => i.Note?.NoteId == noteIdToSelect);
                if (matchingItem != null)
                    SelectedTreeItem = matchingItem;
                else
                    NavigateToNoteById(noteIdToSelect);
            }

            var sidebarOpen = await _settingsService.GetAsync(NotesEditorConstants.NotesSidebarOpenKey, true);
            _sidebarStateLoaded = false;
            IsSidebarOpen = sidebarOpen;
            _sidebarStateLoaded = true;
        }
        finally
        {
            IsLoading = false;
        }
    }

    public async Task SaveCurrentNoteAsync(Block[]? blocks, string? title = null)
    {
        if (SelectedNote == null) return;
        await SaveNoteWithContentAsync(SelectedNote, blocks, title);
    }

    public async Task SaveNoteWithContentAsync(Note note, Block[]? blocks, string? title = null)
    {
        await _documentMutator.SaveNoteWithContentAsync(note, blocks, title);
        if (title != null && SelectedNote == note)
        {
            if (SelectedNoteTitle != note.Title)
                SelectedNoteTitle = note.Title;
            RefreshBreadcrumbText();
        }
        if (SelectedNote == note)
            ModifiedText = FormatRelative(note.ModifiedAt, "LastModified", "Notes");
    }

    public Block[] GetBlocksForCurrentNote() => _editor.GetBlocksForCurrentNote(SelectedNote);

    public string? ResolveNoteTitleForPageBlock(string noteId) =>
        _editor.ResolveNoteTitleForPageBlock(noteId);

    public int CountDirectChildPagesForNote(string noteId) =>
        _editor.CountDirectChildPagesForNote(noteId);

    public async Task<string?> CreateChildPageNoteUnderParentAsync(string parentNoteId) =>
        await _documentMutator.CreateChildPageNoteUnderParentAsync(parentNoteId);

    public void NavigateToNoteById(string? noteId)
    {
        if (string.IsNullOrWhiteSpace(noteId)) return;
        var result = _editor.ResolveNavigation(noteId.Trim());
        if (result.IsNotFound) return;

        if (result.TreeItem != null)
        {
            SelectedTreeItem = result.TreeItem;
            return;
        }

        if (result.OffTreeNote != null)
        {
            _editor.SuppressSelectedNoteClearOnTreeItemNull = true;
            try
            {
                SelectedNote = result.OffTreeNote;
                SelectedTreeItem = null;
            }
            finally
            {
                _editor.SuppressSelectedNoteClearOnTreeItemNull = false;
            }
            _editor.LastSelectedNoteTreeItem = null;
        }
    }

    [RelayCommand]
    private async Task NewNoteAsync(NoteTreeItemViewModel? context)
    {
        var mutation = await _treeMutator.NewNoteAsync(context, SelectedTreeItem, SelectedNote);
        if (mutation == null) return;
        if (mutation.SelectTreeItem != null)
            SelectedTreeItem = mutation.SelectTreeItem;
        if (mutation.SelectNote != null)
            SelectedNote = mutation.SelectNote;
    }

    [RelayCommand]
    private async Task DuplicateNoteAsync(NoteTreeItemViewModel? item)
    {
        var mutation = await _treeMutator.DuplicateNoteAsync(item);
        if (mutation == null) return;
        if (mutation.SelectTreeItem != null)
            SelectedTreeItem = mutation.SelectTreeItem;
        if (mutation.SelectNote != null)
            SelectedNote = mutation.SelectNote;
    }

    [RelayCommand]
    private void SelectFavourite(NoteTreeItemViewModel? item)
    {
        if (item == null) return;
        SelectedTreeItem = item;
        if (item.Note != null)
            SelectedNote = item.Note;
    }

    [RelayCommand]
    private async Task DeleteNoteAsync(NoteTreeItemViewModel? item)
    {
        var clear = await _treeMutator.DeleteNoteAsync(item, SelectedNote);
        if (clear)
        {
            SelectedTreeItem = null;
            SelectedNote = null;
        }
    }

    [RelayCommand]
    private async Task DeleteFolderAsync(NoteTreeItemViewModel? item)
    {
        var clear = await _treeMutator.DeleteFolderAsync(item, SelectedTreeItem, SelectedNote);
        if (clear)
        {
            SelectedTreeItem = null;
            SelectedNote = null;
        }
    }

    [RelayCommand]
    private async Task RenameFolderAsync(NoteTreeItemViewModel? item) =>
        await _treeMutator.RenameFolderAsync(item);

    [RelayCommand]
    private async Task ToggleFavoriteAsync()
    {
        if (SelectedNote == null) return;
        await _treeMutator.ToggleFavoriteAsync(SelectedNote);
        IsFavorite = SelectedNote.IsFavorite;
    }

    [RelayCommand]
    private async Task NewFolderAsync(NoteTreeItemViewModel? context) =>
        await _treeMutator.NewFolderAsync(context, SelectedTreeItem, SelectedNote);

    [RelayCommand]
    private async Task MoveItemUpAsync(NoteTreeItemViewModel? item) =>
        await _treeMutator.MoveItemUpAsync(item);

    [RelayCommand]
    private async Task MoveItemDownAsync(NoteTreeItemViewModel? item) =>
        await _treeMutator.MoveItemDownAsync(item);

    public async Task MoveTreeItemToRootAsync(NoteTreeItemViewModel source) =>
        await _treeMutator.MoveTreeItemToRootAsync(source);

    public async Task MoveTreeItemAsync(NoteTreeItemViewModel source, NoteTreeItemViewModel target, bool dropOnFolder, bool insertAfterTarget) =>
        await _treeMutator.MoveTreeItemAsync(source, target, dropOnFolder, insertAfterTarget);

    public void OnNavigatedTo(object? parameter)
    {
        _pendingOpenNoteIdAfterLoad = parameter switch
        {
            string s when !string.IsNullOrWhiteSpace(s) => s.Trim(),
            _ => null
        };
        _ = LoadNotesCommand.ExecuteAsync(null);
    }

    public void ClearHistoryOnNoteSwitch(Note? previous, Note? next) =>
        _history.ClearOnNoteSwitch(previous, next);

    internal void RefreshBreadcrumbText()
    {
        if (SelectedNote == null) return;
        NoteBreadcrumb.BuildForNote(SelectedNote, _library.FoldersById);
    }

    internal string FormatRelative(DateTime dateTime, string prefixKey, string ns) =>
        $"{_localizationService.T(prefixKey, ns)} {_dateDisplayService.FormatRelative(dateTime)}";
}
