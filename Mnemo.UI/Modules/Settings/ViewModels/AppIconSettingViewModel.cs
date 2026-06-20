using System.Collections.ObjectModel;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class AppIconSettingViewModel : ViewModelBase
{
    private readonly ISettingsService _settingsService;
    private const string SettingKey = "App.Icon";
    private const string DefaultIcon = "avares://Mnemo.UI/Assets/AppIcons/AppIconDawn.ico";

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    
    [ObservableProperty] private string _currentIconPath = DefaultIcon;

    public ObservableCollection<AppIconOptionViewModel> Options { get; } = new();

    public AppIconSettingViewModel(ISettingsService settingsService, string title, string description)
    {
        _settingsService = settingsService;
        _title = title;
        _description = description;

        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        // Load current without blocking the constructor
        CurrentIconPath = await _settingsService.GetAsync(SettingKey, DefaultIcon);

        // Initialize options
        string[] iconFiles = new[]
        {
            "AppIconDawn.ico",
            "AppIconDusk.ico",
            "AppIconAurora.ico",
            "AppIconEmber.ico",
            "AppIconEarth.ico"
        };

        foreach (var file in iconFiles)
        {
            var path = $"avares://Mnemo.UI/Assets/AppIcons/{file}";
            Options.Add(new AppIconOptionViewModel(path, path == CurrentIconPath, this));
        }
    }

    public async Task SelectIconAsync(string path)
    {
        CurrentIconPath = path;
        foreach (var option in Options)
        {
            option.IsSelected = option.IconPath == path;
        }
        await _settingsService.SetAsync(SettingKey, path);
    }
}
