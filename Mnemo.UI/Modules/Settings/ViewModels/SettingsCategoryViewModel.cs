using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class SettingsCategoryViewModel : ViewModelBase
{
    [ObservableProperty] private string _name;
    [ObservableProperty] private bool _isSelected;
    /// <summary>Short count badge shown after the nav item (e.g. "1" pending update).</summary>
    [ObservableProperty] private string? _badgeText;
    /// <summary>Quiet status chip shown after the nav item (e.g. "Off" when a master switch is disabled).</summary>
    [ObservableProperty] private string? _statusTagText;

    /// <summary>Optional subtitle under the category title; when null, the view uses the default settings blurb.</summary>
    public string? Subtitle { get; init; }

    /// <summary>Stable id used when refreshing categories (e.g. on language change).</summary>
    public string CategoryId { get; }

    /// <summary>Navigation pane group this category is listed under.</summary>
    public SettingsNavSection Section { get; }

    public ObservableCollection<SettingsGroupViewModel> Groups { get; } = new();

    public SettingsCategoryViewModel(string name, string categoryId, SettingsNavSection section = SettingsNavSection.App)
    {
        _name = name;
        CategoryId = categoryId;
        Section = section;
    }
}
