using System.Collections.ObjectModel;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Notes.ViewModels;

namespace Mnemo.UI.Modules.Notes.Services;

/// <summary>In-memory note library and sidebar tree state.</summary>
public sealed class NotesLibrarySession
{
    private readonly ISettingsService _settingsService;

    private Dictionary<string, NoteFolder> _foldersById = new();
    private HashSet<string> _expandedFolderIds = new(StringComparer.Ordinal);
    private bool _suppressExpandFolderPersistence;

    public NotesLibrarySession(ISettingsService settingsService)
    {
        _settingsService = settingsService;
    }

    public ObservableCollection<Note> Notes { get; } = new();
    public ObservableCollection<NoteTreeItemViewModel> RootTreeItems { get; } = new();
    public ObservableCollection<NoteTreeItemViewModel> FavouriteNotes { get; } = new();
    public ObservableCollection<NoteTreeItemViewModel> AllNotesTreeItems { get; } = new();
    public ObservableCollection<NoteTreeItemViewModel> FlattenedTreeItems { get; } = new();

    public IReadOnlyDictionary<string, NoteFolder> FoldersById => _foldersById;
    public IReadOnlySet<string> ExpandedFolderIds => _expandedFolderIds;

    public bool IsRefreshingCollections { get; private set; }

    public static bool IsSidebarListedNote(Note n) => string.IsNullOrEmpty(n.ParentNoteId);

    public void SetFolders(IEnumerable<NoteFolder> folders) =>
        _foldersById = folders.ToDictionary(f => f.FolderId);

    public void SetNotes(IEnumerable<Note> notes)
    {
        Notes.Clear();
        foreach (var n in notes)
            Notes.Add(n);
    }

    public async Task LoadExpandedFolderIdsFromSettingsAsync()
    {
        _expandedFolderIds = new HashSet<string>(StringComparer.Ordinal);
        var json = await _settingsService.GetAsync<string?>(NotesEditorConstants.NotesExpandedFolderIdsKey, null);
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            var ids = JsonSerializer.Deserialize<string[]>(json);
            if (ids == null) return;
            foreach (var id in ids)
            {
                if (!string.IsNullOrEmpty(id))
                    _expandedFolderIds.Add(id);
            }
        }
        catch
        {
            // keep empty
        }
    }

    public async Task BuildTreeAsync(List<NoteFolder> folders, List<Note> notes)
    {
        var folderIdsValid = new HashSet<string>(folders.Select(f => f.FolderId), StringComparer.Ordinal);
        _expandedFolderIds.IntersectWith(folderIdsValid);

        var expandedFolderIds = new HashSet<string>(_expandedFolderIds, StringComparer.Ordinal);

        RootTreeItems.Clear();

        var folderIds = new HashSet<string>(folders.Select(f => f.FolderId));
        var rootFolders = folders
            .Where(f => string.IsNullOrEmpty(f.ParentId))
            .OrderBy(f => f.Order).ThenBy(f => f.Name)
            .ToList();
        var rootNotes = notes
            .Where(n => string.IsNullOrEmpty(n.FolderId) && IsSidebarListedNote(n))
            .OrderBy(n => n.Order)
            .ThenByDescending(n => n.ModifiedAt)
            .ToList();
        var orphanNotes = notes
            .Where(n => !string.IsNullOrEmpty(n.FolderId) && !folderIds.Contains(n.FolderId) && IsSidebarListedNote(n))
            .OrderByDescending(n => n.ModifiedAt)
            .ToList();

        _suppressExpandFolderPersistence = true;
        try
        {
            foreach (var f in rootFolders)
            {
                var node = new NoteTreeItemViewModel(f, OnFolderExpandedChanged);
                AddChildren(node, f.FolderId, folders, notes);
                RootTreeItems.Add(node);
            }

            foreach (var n in rootNotes.Concat(orphanNotes).OrderBy(n => n.Order).ThenByDescending(n => n.ModifiedAt))
                RootTreeItems.Add(new NoteTreeItemViewModel(n));

            RestoreExpanded(RootTreeItems, expandedFolderIds);
        }
        finally
        {
            _suppressExpandFolderPersistence = false;
        }

        await SaveExpandedFolderIdsToSettingsAsync();
    }

    public void RefreshAllNotesFlatList(List<Note>? notes = null)
    {
        var list = notes ?? Notes.ToList();
        AllNotesTreeItems.Clear();
        foreach (var note in list.Where(IsSidebarListedNote).OrderByDescending(n => n.ModifiedAt))
            AllNotesTreeItems.Add(new NoteTreeItemViewModel(note));
    }

    public void RefreshFlattenedTreeItems()
    {
        FlattenedTreeItems.Clear();
        foreach (var item in RootTreeItems)
            FlattenRecursive(item, FlattenedTreeItems);
    }

    public void RefreshFavouriteNotes()
    {
        IsRefreshingCollections = true;
        try
        {
            FavouriteNotes.Clear();
            foreach (var note in Notes.Where(n => n.IsFavorite && IsSidebarListedNote(n)).OrderByDescending(n => n.ModifiedAt))
                FavouriteNotes.Add(new NoteTreeItemViewModel(note) { IsFavouriteEntry = true });
        }
        finally
        {
            IsRefreshingCollections = false;
        }
    }

    public void NotifyTreeItemsForNoteTitleChanged(Note note)
    {
        foreach (var item in FlattenedTreeItems.Where(i => i.Note == note))
            item.NotifyNameChanged();
        foreach (var item in FavouriteNotes.Where(i => i.Note == note))
            item.NotifyNameChanged();
        foreach (var item in AllNotesTreeItems.Where(i => i.Note == note))
            item.NotifyNameChanged();
    }

    public void AddFolderToCache(NoteFolder folder) => _foldersById[folder.FolderId] = folder;

    public void RemoveFolderFromCache(string folderId) => _foldersById.Remove(folderId);

    public void ExpandFolder(string folderId) => _expandedFolderIds.Add(folderId);

    public string BuildFolderPath(string? folderId)
    {
        if (string.IsNullOrWhiteSpace(folderId))
            return string.Empty;

        var names = new Stack<string>();
        var current = folderId;
        while (!string.IsNullOrWhiteSpace(current) && _foldersById.TryGetValue(current, out var folder))
        {
            if (!string.IsNullOrWhiteSpace(folder.Name))
                names.Push(folder.Name);
            current = folder.ParentId;
        }

        return string.Join(" / ", names);
    }

    public int GetNextNoteOrder(string? folderId) =>
        Notes.Where(n => string.Equals(n.FolderId, folderId, StringComparison.Ordinal))
            .Select(n => n.Order)
            .DefaultIfEmpty(-1)
            .Max() + 1;

    public int GetNextFolderOrder(string? parentFolderId) =>
        _foldersById.Values
            .Where(f => string.Equals(f.ParentId, parentFolderId, StringComparison.Ordinal))
            .Select(f => f.Order)
            .DefaultIfEmpty(-1)
            .Max() + 1;

    public bool IsDescendantOf(string folderId, string potentialAncestorId)
    {
        var current = folderId;
        while (!string.IsNullOrEmpty(current) && _foldersById.TryGetValue(current, out var folder))
        {
            if (folder.ParentId == potentialAncestorId) return true;
            current = folder.ParentId;
        }
        return false;
    }

    public static NoteTreeItemViewModel? FindTreeItemByNoteId(IEnumerable<NoteTreeItemViewModel> items, string noteId)
    {
        foreach (var item in items)
        {
            if (item.Note?.NoteId == noteId)
                return item;
            var found = FindTreeItemByNoteId(item.Children, noteId);
            if (found != null)
                return found;
        }
        return null;
    }

    public static void RemoveNoteTreeItem(ObservableCollection<NoteTreeItemViewModel> collection, NoteTreeItemViewModel item)
    {
        for (var i = 0; i < collection.Count; i++)
        {
            if (ReferenceEquals(collection[i], item))
            {
                collection.RemoveAt(i);
                return;
            }
        }
    }

    public static void RemoveNoteTreeItemFromRoot(ObservableCollection<NoteTreeItemViewModel> rootItems, NoteTreeItemViewModel item)
    {
        for (var i = 0; i < rootItems.Count; i++)
        {
            if (ReferenceEquals(rootItems[i], item))
            {
                rootItems.RemoveAt(i);
                return;
            }
            if (RemoveNoteTreeItemRecursive(rootItems[i].Children, item))
                return;
        }
    }

    public static (ObservableCollection<NoteTreeItemViewModel>? collection, int index) FindContainingCollection(
        ObservableCollection<NoteTreeItemViewModel> root,
        NoteTreeItemViewModel item)
    {
        for (var i = 0; i < root.Count; i++)
        {
            if (ReferenceEquals(root[i], item))
                return (root, i);
            var (col, idx) = FindContainingCollection(root[i].Children, item);
            if (col != null) return (col, idx);
        }
        return (null, -1);
    }

    public static string? GetParentFolderIdForCollection(
        ObservableCollection<NoteTreeItemViewModel> root,
        ObservableCollection<NoteTreeItemViewModel> collection)
    {
        if (ReferenceEquals(collection, root)) return null;
        for (var i = 0; i < root.Count; i++)
        {
            if (ReferenceEquals(root[i].Children, collection))
                return root[i].FolderId;
            var found = GetParentFolderIdForCollection(root[i].Children, collection);
            if (found != null) return found;
        }
        return null;
    }

    public async Task RebuildTreeFromCacheAsync()
    {
        await BuildTreeAsync(_foldersById.Values.ToList(), Notes.ToList());
        RefreshFlattenedTreeItems();
    }

    private void OnFolderExpandedChanged(string folderId, bool isExpanded)
    {
        if (_suppressExpandFolderPersistence) return;
        if (isExpanded)
            _expandedFolderIds.Add(folderId);
        else
            _expandedFolderIds.Remove(folderId);
        _ = SaveExpandedFolderIdsToSettingsAsync();
    }

    private async Task SaveExpandedFolderIdsToSettingsAsync()
    {
        var ids = _expandedFolderIds.OrderBy(s => s, StringComparer.Ordinal).ToArray();
        var json = JsonSerializer.Serialize(ids);
        await _settingsService.SetAsync(NotesEditorConstants.NotesExpandedFolderIdsKey, json);
    }

    private static void FlattenRecursive(NoteTreeItemViewModel item, ObservableCollection<NoteTreeItemViewModel> target)
    {
        target.Add(item);
        foreach (var child in item.Children)
            FlattenRecursive(child, target);
    }

    private static void RestoreExpanded(ObservableCollection<NoteTreeItemViewModel> root, HashSet<string> expandedIds)
    {
        foreach (var item in root)
        {
            if (item.IsFolder && item.FolderId != null)
                item.IsExpanded = expandedIds.Contains(item.FolderId);
            RestoreExpanded(item.Children, expandedIds);
        }
    }

    private void AddChildren(NoteTreeItemViewModel node, string parentFolderId, List<NoteFolder> folders, List<Note> notes)
    {
        var childFolders = folders.Where(f => f.ParentId == parentFolderId).OrderBy(f => f.Order).ThenBy(f => f.Name).ToList();
        var childNotes = notes.Where(n => n.FolderId == parentFolderId && IsSidebarListedNote(n)).OrderBy(n => n.Order).ThenByDescending(n => n.ModifiedAt).ToList();

        foreach (var f in childFolders)
        {
            var childNode = new NoteTreeItemViewModel(f, OnFolderExpandedChanged);
            AddChildren(childNode, f.FolderId, folders, notes);
            node.Children.Add(childNode);
        }

        foreach (var n in childNotes)
            node.Children.Add(new NoteTreeItemViewModel(n));
    }

    private static bool RemoveNoteTreeItemRecursive(ObservableCollection<NoteTreeItemViewModel> children, NoteTreeItemViewModel item)
    {
        for (var i = 0; i < children.Count; i++)
        {
            if (ReferenceEquals(children[i], item))
            {
                children.RemoveAt(i);
                return true;
            }
            if (RemoveNoteTreeItemRecursive(children[i].Children, item))
                return true;
        }
        return false;
    }
}
