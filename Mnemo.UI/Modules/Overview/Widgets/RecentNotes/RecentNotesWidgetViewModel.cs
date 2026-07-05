using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Widgets.RecentNotes;

public partial class RecentNoteRow : ObservableObject
{
    [ObservableProperty]
    private string _noteId = string.Empty;

    [ObservableProperty]
    private string _title = string.Empty;

    /// <summary>Right-column meta: "Folder · date", or just the date for notes at the library root.</summary>
    [ObservableProperty]
    private string _metaText = string.Empty;
}

/// <summary>
/// ViewModel for the Recent Notes widget. Settings: <c>days_to_show</c> window,
/// <c>sort_by</c> ("date" = created, "modified" = last edited), and <c>limit</c>.
/// </summary>
public partial class RecentNotesWidgetViewModel : WidgetViewModelBase
{
    private readonly IWidgetContext _context;

    public ObservableCollection<RecentNoteRow> Items { get; } = new();

    /// <summary>True after a load that produced no rows; drives the widget's empty message.</summary>
    [ObservableProperty]
    private bool _isEmpty;

    public RecentNotesWidgetViewModel(WidgetManifest manifest, WidgetInstance instance, IWidgetContext context)
        : base(manifest, instance)
    {
        _context = context;
    }

    public override async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var daysToShow = GetIntSetting("days_to_show");
            var sortBy = GetStringSetting("sort_by");
            var limit = GetIntSetting("limit");
            var cutoffUtc = DateTime.UtcNow.AddDays(-daysToShow);
            var sortByCreated = string.Equals(sortBy, "date", StringComparison.Ordinal);

            var notes = await _context.Notes.GetAllNotesAsync();
            var rows = notes
                .Where(n => (sortByCreated ? n.CreatedAt : n.ModifiedAt) >= cutoffUtc)
                .OrderByDescending(n => sortByCreated ? n.CreatedAt : n.ModifiedAt)
                .Take(limit)
                .ToList();

            Items.Clear();
            foreach (var n in rows)
            {
                var date = _context.DateDisplay.FormatSmart(n.ModifiedAt);
                Items.Add(new RecentNoteRow
                {
                    NoteId = n.NoteId,
                    Title = string.IsNullOrWhiteSpace(n.Title) ? _context.Localization.T("Untitled", "RecentNotes") : n.Title.Trim(),
                    MetaText = string.IsNullOrWhiteSpace(n.FolderPath) ? date : $"{n.FolderPath.Trim()} · {date}"
                });
            }

            IsEmpty = Items.Count == 0;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _context.Logger.Error("Overview", "Recent notes widget failed to load.", ex);
            Items.Clear();
            IsEmpty = true;
        }
    }

    [RelayCommand]
    private void OpenNote(string? noteId)
    {
        if (IsEditing || string.IsNullOrWhiteSpace(noteId))
            return;
        _context.Navigation.NavigateTo("notes", noteId.Trim());
    }
}
