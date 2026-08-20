using System.Collections.ObjectModel;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.UI.Modules.Notes.ViewModels;

namespace Mnemo.UI.Modules.Notes.Services;

/// <summary>Library mutations: CRUD, reorder, and tree drag-drop.</summary>
public sealed class NotesTreeMutator
{
    private readonly NotesLibrarySession _library;
    private readonly INoteService _noteService;
    private readonly INoteFolderService _folderService;
    private readonly IStatisticsManager _statistics;
    private readonly IStudyDayService _studyDay;
    private readonly ILocalizationService _localization;
    private readonly ILoggerService _logger;

    public NotesTreeMutator(
        NotesLibrarySession library,
        INoteService noteService,
        INoteFolderService folderService,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILocalizationService localization,
        ILoggerService logger)
    {
        _library = library;
        _noteService = noteService;
        _folderService = folderService;
        _statistics = statistics;
        _studyDay = studyDay;
        _localization = localization;
        _logger = logger;
    }

    public async Task<TreeMutationResult?> NewNoteAsync(NoteTreeItemViewModel? context, NoteTreeItemViewModel? selectedTreeItem, Note? selectedNote)
    {
        var parentFolderId = ResolveCreationFolderId(context, selectedTreeItem, selectedNote);
        var note = new Note
        {
            Title = "Untitled",
            FolderId = parentFolderId,
            FolderPath = _library.BuildFolderPath(parentFolderId),
            Order = _library.GetNextNoteOrder(parentFolderId)
        };

        _library.Notes.Add(note);
        var result = await _noteService.SaveNoteAsync(note);
        if (!result.IsSuccess)
        {
            _library.Notes.Remove(note);
            return null;
        }

        if (!string.IsNullOrEmpty(parentFolderId))
            _library.ExpandFolder(parentFolderId);

        await _library.BuildTreeAsync(_library.FoldersById.Values.ToList(), _library.Notes.ToList());
        _library.RefreshAllNotesFlatList();
        _library.RefreshFlattenedTreeItems();
        _library.RefreshFavouriteNotes();

        var item = NotesLibrarySession.FindTreeItemByNoteId(_library.RootTreeItems, note.NoteId)
            ?? _library.AllNotesTreeItems.FirstOrDefault(i => i.Note?.NoteId == note.NoteId);

        _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger, _studyDay,
            StatisticsNamespaces.Notes, NoteStatKinds.DailySummary, "notes_created");
        _ = StatisticsRecorder.IncrementLifetimeAsync(_statistics, _logger,
            StatisticsNamespaces.Notes, NoteStatKinds.LifetimeTotals, "total_notes_created");

        return new TreeMutationResult { SelectTreeItem = item, SelectNote = note };
    }

    public async Task<TreeMutationResult?> DuplicateNoteAsync(NoteTreeItemViewModel? item)
    {
        if (item?.Note == null) return null;
        var source = item.Note;

        var bumped = new List<Note>();
        foreach (var n in _library.Notes.Where(n => n.FolderId == source.FolderId))
        {
            if (n.Order > source.Order)
            {
                n.Order++;
                bumped.Add(n);
            }
        }

        var clone = new Note
        {
            NoteId = Guid.NewGuid().ToString(),
            Title = FormatDuplicateNoteTitle(source.Title),
            FolderId = source.FolderId,
            FolderPath = source.FolderPath,
            ParentNoteId = null,
            Content = source.Content ?? string.Empty,
            Blocks = CloneNoteBlocksForDuplicate(source.Blocks),
            Order = source.Order + 1,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow,
            IsFavorite = false
        };

        _library.Notes.Add(clone);
        await _noteService.SaveNoteAsync(clone);

        _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger, _studyDay,
            StatisticsNamespaces.Notes, NoteStatKinds.DailySummary, "notes_created");
        _ = StatisticsRecorder.IncrementLifetimeAsync(_statistics, _logger,
            StatisticsNamespaces.Notes, NoteStatKinds.LifetimeTotals, "total_notes_created");

        foreach (var n in bumped)
            await _noteService.SaveNoteAsync(n);

        await _library.BuildTreeAsync(_library.FoldersById.Values.ToList(), _library.Notes.ToList());
        _library.RefreshAllNotesFlatList();
        _library.RefreshFlattenedTreeItems();

        var newVm = NotesLibrarySession.FindTreeItemByNoteId(_library.RootTreeItems, clone.NoteId);
        return new TreeMutationResult { SelectTreeItem = newVm, SelectNote = clone };
    }

    public async Task<bool> DeleteNoteAsync(NoteTreeItemViewModel? item, Note? selectedNote)
    {
        if (item?.Note == null) return false;

        var note = item.Note;
        var result = await _noteService.DeleteNoteAsync(note.NoteId);
        if (!result.IsSuccess) return false;

        var clearSelection = selectedNote == note;
        _library.Notes.Remove(note);
        NotesLibrarySession.RemoveNoteTreeItem(_library.AllNotesTreeItems, item);
        NotesLibrarySession.RemoveNoteTreeItem(_library.FavouriteNotes, item);
        NotesLibrarySession.RemoveNoteTreeItemFromRoot(_library.RootTreeItems, item);
        _library.RefreshFlattenedTreeItems();

        _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger, _studyDay,
            StatisticsNamespaces.Notes, NoteStatKinds.DailySummary, "notes_deleted");
        _ = StatisticsRecorder.IncrementLifetimeAsync(_statistics, _logger,
            StatisticsNamespaces.Notes, NoteStatKinds.LifetimeTotals, "total_notes_deleted");

        return clearSelection;
    }

    public async Task<bool> DeleteFolderAsync(NoteTreeItemViewModel? item, NoteTreeItemViewModel? selectedTreeItem, Note? selectedNote)
    {
        if (item?.Folder == null || item.FolderId == null) return false;

        var folderId = item.FolderId;
        var clearSelection = selectedTreeItem != null &&
            (ReferenceEquals(selectedTreeItem, item) || selectedTreeItem.Note?.FolderId == folderId);

        foreach (var note in _library.Notes.Where(n => n.FolderId == folderId).ToList())
        {
            note.FolderId = null;
            await _noteService.SaveNoteAsync(note);
        }

        foreach (var folder in _library.FoldersById.Values.Where(f => f.ParentId == folderId).ToList())
        {
            folder.ParentId = null;
            await _folderService.SaveFolderAsync(folder);
        }

        var result = await _folderService.DeleteFolderAsync(folderId);
        if (!result.IsSuccess) return false;

        _library.RemoveFolderFromCache(folderId);
        await _library.BuildTreeAsync(_library.FoldersById.Values.ToList(), _library.Notes.ToList());
        _library.RefreshFlattenedTreeItems();
        _library.RefreshFavouriteNotes();

        return clearSelection;
    }

    public async Task RenameFolderAsync(NoteTreeItemViewModel? item)
    {
        if (item?.Folder == null) return;
        await _folderService.SaveFolderAsync(item.Folder);
    }

    public async Task ToggleFavoriteAsync(Note selectedNote)
    {
        selectedNote.IsFavorite = !selectedNote.IsFavorite;
        await _noteService.SaveNoteAsync(selectedNote);
        _library.RefreshFavouriteNotes();
    }

    public async Task NewFolderAsync(NoteTreeItemViewModel? context, NoteTreeItemViewModel? selectedTreeItem, Note? selectedNote)
    {
        var parentFolderId = ResolveCreationFolderId(context, selectedTreeItem, selectedNote);
        var folder = new NoteFolder
        {
            Name = "New folder",
            ParentId = parentFolderId,
            Order = _library.GetNextFolderOrder(parentFolderId)
        };
        var result = await _folderService.SaveFolderAsync(folder);
        if (!result.IsSuccess) return;

        _library.AddFolderToCache(folder);
        if (!string.IsNullOrEmpty(parentFolderId))
            _library.ExpandFolder(parentFolderId);
        await _library.BuildTreeAsync(_library.FoldersById.Values.ToList(), _library.Notes.ToList());
        _library.RefreshFlattenedTreeItems();
    }

    public async Task MoveItemUpAsync(NoteTreeItemViewModel? item)
    {
        if (item == null) return;
        var (col, idx) = NotesLibrarySession.FindContainingCollection(_library.RootTreeItems, item);
        if (col == null || idx <= 0) return;
        col.Move(idx, idx - 1);
        await PersistOrderAsync(col);
    }

    public async Task MoveItemDownAsync(NoteTreeItemViewModel? item)
    {
        if (item == null) return;
        var (col, idx) = NotesLibrarySession.FindContainingCollection(_library.RootTreeItems, item);
        if (col == null || idx < 0 || idx >= col.Count - 1) return;
        col.Move(idx, idx + 1);
        await PersistOrderAsync(col);
    }

    public async Task MoveTreeItemToRootAsync(NoteTreeItemViewModel source)
    {
        if (source == null) return;

        if (source.IsFolder && source.Folder != null)
        {
            source.Folder.ParentId = null;
            var r = await _folderService.SaveFolderAsync(source.Folder);
            if (!r.IsSuccess) return;
        }
        else if (source.Note != null)
        {
            source.Note.FolderId = null;
            var r = await _noteService.SaveNoteAsync(source.Note);
            if (!r.IsSuccess) return;
        }
        else
            return;

        await _library.BuildTreeAsync(_library.FoldersById.Values.ToList(), _library.Notes.ToList());
        _library.RefreshFlattenedTreeItems();
        _library.RefreshFavouriteNotes();
    }

    public async Task MoveTreeItemAsync(NoteTreeItemViewModel source, NoteTreeItemViewModel target, bool dropOnFolder, bool insertAfterTarget)
    {
        if (source == null || target == null) return;
        if (ReferenceEquals(source, target) && dropOnFolder) return;

        if (dropOnFolder)
        {
            if (!target.IsFolder || target.FolderId == null) return;
            if (source.IsFolder && _library.IsDescendantOf(target.FolderId!, source.FolderId!)) return;

            if (source.IsFolder && source.Folder != null)
            {
                source.Folder.ParentId = target.FolderId;
                var siblingFolders = _library.FoldersById.Values.Where(f => f.ParentId == target.FolderId).OrderBy(f => f.Order).ToList();
                source.Folder.Order = siblingFolders.Count;
                var r = await _folderService.SaveFolderAsync(source.Folder);
                if (!r.IsSuccess) return;
            }
            else if (source.Note != null)
            {
                source.Note.FolderId = target.FolderId;
                var siblingNotes = _library.Notes.Where(n => n.FolderId == target.FolderId).OrderBy(n => n.Order).ToList();
                source.Note.Order = siblingNotes.Count;
                var r = await _noteService.SaveNoteAsync(source.Note);
                if (!r.IsSuccess) return;
            }
            else
                return;

            await _library.BuildTreeAsync(_library.FoldersById.Values.ToList(), _library.Notes.ToList());
            _library.RefreshFlattenedTreeItems();
            _library.RefreshFavouriteNotes();
            return;
        }

        var (sourceCol, sourceIndex) = NotesLibrarySession.FindContainingCollection(_library.RootTreeItems, source);
        var (targetCol, targetIndex) = NotesLibrarySession.FindContainingCollection(_library.RootTreeItems, target);
        if (sourceCol == null || targetCol == null) return;

        var fromIdx = sourceIndex;
        var toIdx = insertAfterTarget ? targetIndex + 1 : targetIndex;
        if (fromIdx < 0 || toIdx < 0) return;

        var sameParent = ReferenceEquals(sourceCol, targetCol);
        var insertIdx = sameParent && toIdx > fromIdx ? toIdx - 1 : toIdx;
        if (insertIdx < 0) insertIdx = 0;

        var movedItem = sourceCol[fromIdx];
        sourceCol.RemoveAt(fromIdx);

        if (!sameParent)
        {
            var targetParentFolderId = NotesLibrarySession.GetParentFolderIdForCollection(_library.RootTreeItems, targetCol);
            if (movedItem.IsFolder && movedItem.Folder != null)
            {
                if (targetParentFolderId != null && _library.IsDescendantOf(targetParentFolderId, movedItem.FolderId!))
                {
                    sourceCol.Insert(fromIdx, movedItem);
                    return;
                }
                movedItem.Folder.ParentId = targetParentFolderId;
                var r = await _folderService.SaveFolderAsync(movedItem.Folder);
                if (!r.IsSuccess)
                {
                    sourceCol.Insert(fromIdx, movedItem);
                    return;
                }
            }
            else if (movedItem.Note != null)
            {
                movedItem.Note.FolderId = targetParentFolderId;
                var r = await _noteService.SaveNoteAsync(movedItem.Note);
                if (!r.IsSuccess)
                {
                    sourceCol.Insert(fromIdx, movedItem);
                    return;
                }
            }
            else
            {
                sourceCol.Insert(fromIdx, movedItem);
                return;
            }
        }
        else if (fromIdx == toIdx || (fromIdx < toIdx && toIdx == fromIdx + 1))
        {
            sourceCol.Insert(fromIdx, movedItem);
            return;
        }

        targetCol.Insert(Math.Min(insertIdx, targetCol.Count), movedItem);
        await PersistOrderAsync(sourceCol);
        await PersistOrderAsync(targetCol);
        await _library.BuildTreeAsync(_library.FoldersById.Values.ToList(), _library.Notes.ToList());
        _library.RefreshFlattenedTreeItems();
        _library.RefreshFavouriteNotes();
    }

    private async Task PersistOrderAsync(ObservableCollection<NoteTreeItemViewModel> siblings)
    {
        for (var i = 0; i < siblings.Count; i++)
        {
            var node = siblings[i];
            if (node.Folder != null)
            {
                node.Folder.Order = i;
                await _folderService.SaveFolderAsync(node.Folder);
            }
            else if (node.Note != null)
            {
                node.Note.Order = i;
                await _noteService.SaveNoteAsync(node.Note);
            }
        }
    }

    private string? ResolveCreationFolderId(NoteTreeItemViewModel? context, NoteTreeItemViewModel? selectedTreeItem, Note? selectedNote)
    {
        if (context?.FolderId != null)
            return context.FolderId;
        if (context?.Note != null)
            return context.Note.FolderId;
        if (selectedTreeItem?.FolderId != null)
            return selectedTreeItem.FolderId;
        if (selectedTreeItem?.Note != null)
            return selectedTreeItem.Note.FolderId;
        return selectedNote?.FolderId;
    }

    private string FormatDuplicateNoteTitle(string? title)
    {
        var baseTitle = string.IsNullOrWhiteSpace(title) ? "Untitled" : title.Trim();
        return string.Format(_localization.T("DuplicateNoteTitleFormat", "Notes"), baseTitle);
    }

    private static List<Block>? CloneNoteBlocksForDuplicate(List<Block>? blocks)
    {
        if (blocks == null || blocks.Count == 0)
            return null;
        foreach (var b in blocks)
            b.EnsureSpans();
        var json = JsonSerializer.Serialize(blocks);
        var list = JsonSerializer.Deserialize<List<Block>>(json);
        if (list == null || list.Count == 0)
            return null;
        var ordered = list.OrderBy(b => b.Order).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            ordered[i].Id = Guid.NewGuid().ToString();
            ordered[i].Order = i;
            ordered[i].EnsureSpans();
        }
        return ordered;
    }
}

public sealed class TreeMutationResult
{
    public NoteTreeItemViewModel? SelectTreeItem { get; init; }
    public Note? SelectNote { get; init; }
}
