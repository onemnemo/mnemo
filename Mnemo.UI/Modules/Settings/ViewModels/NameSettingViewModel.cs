using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class NameSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ISettingsService _settingsService;
    private readonly string _settingsKey = "User.DisplayName";

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    [ObservableProperty] private string _userName = "John Doe";

    public NameSettingViewModel(ISettingsService settingsService, string title, string description)
    {
        _settingsService = settingsService;
        _title = title;
        _description = description;
        
        _userName = _settingsService.GetAsync(_settingsKey, "John Doe").GetAwaiter().GetResult();
    }

    partial void OnUserNameChanged(string value)
    {
        _settingsService.SetAsync(_settingsKey, value).ConfigureAwait(false);
    }
}

