using Mnemo.Core.Models;
using Mnemo.UI.Modules.Notes.Services;

namespace Mnemo.UI.Modules.Notes.ViewModels;

public partial class NotesViewModel
{
    partial void OnSelectedNoteTitleChanged(string value)
    {
        if (SelectedNote == null) return;
        if (SelectedNote.Title == value) return;
        SelectedNote.Title = value;
        RefreshBreadcrumbText();
    }

    partial void OnSelectedTreeItemChanged(NoteTreeItemViewModel? value)
    {
        var result = _editor.HandleTreeItemChanged(value, SelectedTreeItem);

        if (result.RevertTreeItem != null)
        {
            SelectedTreeItem = result.RevertTreeItem;
            return;
        }

        if (result.IsNoChange) return;

        if (result.Clear)
        {
            SelectedNote = null;
            return;
        }

        if (result.Note != null)
            SelectedNote = result.Note;
        else
            SelectedNote = null;
    }

    partial void OnSelectedNoteChanged(Note? value)
    {
        if (value == null)
        {
            NoteBreadcrumb.BuildForNote(null, _library.FoldersById);
            CreatedText = string.Empty;
            ModifiedText = string.Empty;
            SaveStateText = string.Empty;
            WordCountText = string.Empty;
            IsFavorite = false;
            SelectedNoteTitle = string.Empty;
            return;
        }

        var title = value.Title ?? string.Empty;
        if (SelectedNoteTitle != title)
            SelectedNoteTitle = title;

        _ = _settingsService.SetAsync(NotesEditorConstants.LastOpenNoteIdKey, value.NoteId);

        IsFavorite = value.IsFavorite;
        NoteBreadcrumb.BuildForNote(value, _library.FoldersById);
        CreatedText = FormatRelative(value.CreatedAt, "Created", "Notes");
        ModifiedText = FormatRelative(value.ModifiedAt, "LastModified", "Notes");
        SaveStateText = FormatSaveState(value.ModifiedAt);
    }
}
