using System;
using System.Collections.ObjectModel;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.UI.Modules.Notes.Services;

namespace Mnemo.UI.Modules.Notes.ViewModels;

public partial class NotesViewModel
{
    [ObservableProperty]
    private string _searchText = string.Empty;

    /// <summary>Flat note rows matching <see cref="SearchText"/>; shown instead of the tree while searching.</summary>
    public ObservableCollection<NoteTreeItemViewModel> SearchResults { get; } = new();

    public bool IsSearching => !string.IsNullOrWhiteSpace(SearchText);

    public bool HasNoSearchResults => IsSearching && SearchResults.Count == 0;

    [RelayCommand]
    private void ToggleSidebar() => IsSidebarOpen = !IsSidebarOpen;

    partial void OnSearchTextChanged(string value)
    {
        RefreshSearchResults();
        OnPropertyChanged(nameof(IsSearching));
        OnPropertyChanged(nameof(HasNoSearchResults));
    }

    private void RefreshSearchResults()
    {
        SearchResults.Clear();
        if (!IsSearching) return;

        var term = SearchText.Trim();
        foreach (var item in AllNotesTreeItems)
        {
            if (item.Name.Contains(term, StringComparison.OrdinalIgnoreCase))
                SearchResults.Add(item);
        }
    }

    private async Task UpdateEditorWidthAsync()
    {
        var widthStr = await _settingsService.GetAsync(NotesEditorConstants.EditorWidthKey, _localizationService.T("Wide", "Settings"));
        if (string.IsNullOrWhiteSpace(widthStr))
        {
            await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() => EditorMaxWidth = 1000);
            return;
        }

        var superCompact = _localizationService.T("SuperCompact", "Settings");
        var compact = _localizationService.T("Compact", "Settings");
        var wide = _localizationService.T("Wide", "Settings");
        var superWide = _localizationService.T("SuperWide", "Settings");

        double width = 1000;
        if (widthStr == superCompact) width = 600;
        else if (widthStr == compact) width = 800;
        else if (widthStr == wide) width = 1000;
        else if (widthStr == superWide) width = 1600;

        var w = width;
        await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() => EditorMaxWidth = w);
    }
}
