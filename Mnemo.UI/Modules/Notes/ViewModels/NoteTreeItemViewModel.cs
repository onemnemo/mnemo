using System;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models;

namespace Mnemo.UI.Modules.Notes.ViewModels;

/// <summary>
/// Represents either a folder, a note, or a synthetic container (e.g. "Uncategorized") in the sidebar tree.
/// </summary>
public partial class NoteTreeItemViewModel : ObservableObject
{
    private readonly Action<string, bool>? _onFolderExpandedChanged;

    [ObservableProperty]
    private bool _isExpanded;

    public bool IsFolder { get; }
    public string? FolderId { get; }
    public NoteFolder? Folder { get; }
    public Note? Note { get; }

    /// <summary>
    /// True when this item is a folder with no children (used for empty folder icon).
    /// </summary>
    public bool IsFolderEmpty => IsFolder && Children.Count == 0;

    /// <summary>
    /// True when this item is a folder with at least one child (used for filled folder icon).
    /// </summary>
    public bool IsFolderWithChildren => IsFolder && Children.Count > 0;

    /// <summary>
    /// True when this item is a real folder that can be renamed (not a synthetic container like "Uncategorized").
    /// </summary>
    public bool IsRenamableFolder => IsFolder && Folder != null;

    /// <summary>
    /// Number of notes in this folder's subtree (folders themselves excluded). 0 for note rows.
    /// Refreshed when direct children change; deeper moves rebuild the tree, which recreates rows.
    /// </summary>
    public int NoteCount => IsFolder ? CountNotes(this) : 0;

    /// <summary>
    /// True when this row is rendered in the Favourites section (shows the star glyph instead of indent).
    /// </summary>
    public bool IsFavouriteEntry { get; init; }

    /// <summary>
    /// Display name for synthetic container nodes (e.g. "Uncategorized"); null for real folders/notes.
    /// </summary>
    private readonly string? _syntheticName;

    /// <summary>
    /// Display name (folder name, note title, or synthetic name).
    /// </summary>
    public string Name => _syntheticName ?? (IsFolder ? (Folder?.Name ?? "") : (Note?.Title ?? "Untitled"));

    public ObservableCollection<NoteTreeItemViewModel> Children { get; } = new();

    public NoteTreeItemViewModel(NoteFolder folder, Action<string, bool>? onFolderExpandedChanged = null)
    {
        IsFolder = true;
        FolderId = folder.FolderId;
        Folder = folder;
        _onFolderExpandedChanged = onFolderExpandedChanged;
        Children.CollectionChanged += OnChildrenChanged;
    }

    /// <summary>
    /// Synthetic container with no backing folder (e.g. "Uncategorized" for notes without a folder).
    /// </summary>
    public NoteTreeItemViewModel(string displayName)
    {
        IsFolder = true;
        FolderId = null;
        Folder = null;
        _syntheticName = displayName;
        Children.CollectionChanged += OnChildrenChanged;
    }

    public NoteTreeItemViewModel(Note note)
    {
        IsFolder = false;
        Note = note;
        IsExpanded = true; // leaf rows; binding exists on tree item — avoid collapsed chrome
    }

    /// <summary>
    /// Updates the folder name and notifies the view. Only valid when <see cref="Folder"/> is not null.
    /// </summary>
    public void SetFolderName(string name)
    {
        if (Folder == null) return;
        Folder.Name = name;
        OnPropertyChanged(nameof(Name));
    }

    /// <summary>
    /// Notifies the view that the display name changed (e.g. note title edited). Name is computed from Note.Title or Folder.Name.
    /// </summary>
    public void NotifyNameChanged()
    {
        OnPropertyChanged(nameof(Name));
    }

    private void OnChildrenChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        OnPropertyChanged(nameof(IsFolderEmpty));
        OnPropertyChanged(nameof(IsFolderWithChildren));
        OnPropertyChanged(nameof(NoteCount));
    }

    private static int CountNotes(NoteTreeItemViewModel item)
    {
        var count = 0;
        foreach (var child in item.Children)
            count += child.IsFolder ? CountNotes(child) : 1;
        return count;
    }

    partial void OnIsExpandedChanged(bool value)
    {
        if (IsFolder && FolderId != null)
            _onFolderExpandedChanged?.Invoke(FolderId, value);
    }
}
