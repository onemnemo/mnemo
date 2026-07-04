using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Widgets.RecentNotes;

public partial class RecentNoteRow : ObservableObject
{
    [ObservableProperty]
    private string _noteId = string.Empty;

    [ObservableProperty]
    private string _title = string.Empty;

    /// <summary>Folder path or em dash when at library root.</summary>
    [ObservableProperty]
    private string _folderLine = string.Empty;

    /// <summary>Right-column modified date, aligned with Recent Decks last-practiced column.</summary>
    [ObservableProperty]
    private string _modifiedColumnText = string.Empty;
}

public partial class RecentNotesWidgetViewModel : WidgetViewModelBase
{
    private const int MaxItems = 6;

    private readonly INoteService _notes;
    private readonly INavigationService _navigation;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService _localization;
    private readonly IDateDisplayService _dateDisplay;

    public ObservableCollection<RecentNoteRow> Items { get; } = new();

    public RecentNotesWidgetViewModel(
        INoteService notes,
        INavigationService navigation,
        ILoggerService logger,
        ILocalizationService localization,
        IDateDisplayService dateDisplay)
    {
        _notes = notes;
        _navigation = navigation;
        _logger = logger;
        _localization = localization;
        _dateDisplay = dateDisplay;
    }

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();
        Items.Clear();

        try
        {
            var list = (await _notes.GetAllNotesAsync().ConfigureAwait(false))
                .OrderByDescending(n => n.ModifiedAt)
                .Take(MaxItems)
                .ToList();

            foreach (var n in list)
            {
                Items.Add(new RecentNoteRow
                {
                    NoteId = n.NoteId,
                    Title = string.IsNullOrWhiteSpace(n.Title) ? _localization.T("Untitled", "RecentNotes") : n.Title.Trim(),
                    FolderLine = string.IsNullOrWhiteSpace(n.FolderPath) ? "—" : n.FolderPath.Trim(),
                    ModifiedColumnText = _dateDisplay.FormatSmart(n.ModifiedAt)
                });
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Overview", "Recent notes widget failed to load.", ex);
        }
    }

    [RelayCommand]
    private void OpenNote(string? noteId)
    {
        if (string.IsNullOrWhiteSpace(noteId))
            return;
        _navigation.NavigateTo("notes", noteId.Trim());
    }
}
