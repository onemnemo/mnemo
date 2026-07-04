using System;
using System.Collections.ObjectModel;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class StepSliderSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ISettingsService _settingsService;
    private readonly string _settingsKey;

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    
    [ObservableProperty] private int _selectedIndex;
    [ObservableProperty] private bool _isInteractionEnabled = true;

    public ObservableCollection<string> Options { get; }
    public int MaxIndex => Options.Count - 1;

    public StepSliderSettingViewModel(
        ISettingsService settingsService,
        string settingsKey,
        string title,
        string description,
        string[] options,
        string? defaultValue = null,
        bool isInteractionEnabled = true)
    {
        _settingsService = settingsService;
        _settingsKey = settingsKey;
        _title = title;
        _description = description;
        _isInteractionEnabled = isInteractionEnabled;
        Options = new ObservableCollection<string>(options);
        
        // Initialize value from settings
        var defaultVal = defaultValue ?? options[0];
        // We need to run this synchronously in constructor for simplicity, though async factory is better pattern
        var savedValue = _settingsService.GetAsync(_settingsKey, defaultVal).GetAwaiter().GetResult();
        
        var index = Array.IndexOf(options, savedValue ?? defaultVal);
        _selectedIndex = index >= 0 ? index : 0;
    }

    partial void OnSelectedIndexChanged(int value)
    {
        if (value >= 0 && value < Options.Count)
        {
            _settingsService.SetAsync(_settingsKey, Options[value]).ConfigureAwait(false);
        }
    }
}
