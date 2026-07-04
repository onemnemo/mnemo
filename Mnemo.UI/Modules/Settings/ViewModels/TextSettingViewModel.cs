using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class TextSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ISettingsService _settingsService;
    private readonly string _settingsKey;

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    [ObservableProperty] private string _value;
    [ObservableProperty] private bool _isPassword;

    public TextSettingViewModel(ISettingsService settingsService, string settingsKey, string title, string description, string defaultValue = "", bool isPassword = false)
    {
        _settingsService = settingsService;
        _settingsKey = settingsKey;
        _title = title;
        _description = description;
        _isPassword = isPassword;
        
        _value = _settingsService.GetAsync(_settingsKey, defaultValue).GetAwaiter().GetResult();
    }

    partial void OnValueChanged(string value)
    {
        _settingsService.SetAsync(_settingsKey, value).ConfigureAwait(false);
    }
}
