using System.Collections.ObjectModel;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class SettingsCategoryViewModel : ViewModelBase
{
    private readonly SettingsViewModel? _owner;

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

    // Proxied through the owning SettingsViewModel (rather than the nav item template binding
    // "$parent[UserControl].DataContext.X") so navigating away from Settings — which briefly nulls
    // the ambient DataContext while the view is torn down — never logs a null binding error.
    public ICommand? SelectCommand => _owner?.SelectCategoryCommand;

    public string? ProfilePicturePath => _owner?.ProfilePicturePath;

    public SettingsCategoryViewModel(string name, string categoryId, SettingsNavSection section = SettingsNavSection.App, SettingsViewModel? owner = null)
    {
        _name = name;
        CategoryId = categoryId;
        Section = section;
        _owner = owner;
    }

    /// <summary>Owner calls this when its own <see cref="SettingsViewModel.ProfilePicturePath"/> changes.</summary>
    public void NotifyProfilePicturePathChanged() => OnPropertyChanged(nameof(ProfilePicturePath));
}
