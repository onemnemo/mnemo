using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

/// <summary>Read-only notice row (title + description) for settings categories.</summary>
public partial class SettingsNoticeViewModel : ViewModelBase, ISettingsSearchable
{
    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;

    public SettingsNoticeViewModel(string title, string description)
    {
        _title = title;
        _description = description;
    }
}
