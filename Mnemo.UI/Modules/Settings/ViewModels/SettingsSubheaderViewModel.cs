using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

/// <summary>
/// Uppercase sub-section label rendered between rows inside a settings group
/// (e.g. "Web search" inside the AI master group). Carries no setting value and
/// is excluded from search and hidden-row counts.
/// </summary>
public partial class SettingsSubheaderViewModel : ViewModelBase
{
    [ObservableProperty] private string _title;

    public SettingsSubheaderViewModel(string title)
    {
        _title = title;
    }
}
