using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class ToggleSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ISettingsService _settingsService;
    private readonly string _settingsKey;

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    [ObservableProperty] private bool _value;
    [ObservableProperty] private bool _isInteractionEnabled = true;

    public ToggleSettingViewModel(
        ISettingsService settingsService,
        string settingsKey,
        string title,
        string description,
        bool defaultValue = false,
        bool isInteractionEnabled = true)
    {
        _settingsService = settingsService;
        _settingsKey = settingsKey;
        _title = title;
        _description = description;
        _isInteractionEnabled = isInteractionEnabled;

        // Initialize value from settings
        _value = _settingsService.GetAsync(_settingsKey, defaultValue).GetAwaiter().GetResult();
    }

    partial void OnValueChanged(bool value)
    {
        _settingsService.SetAsync(_settingsKey, value).ConfigureAwait(false);
    }
}
