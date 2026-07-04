using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class ThemeSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly IThemeService _themeService;
    
    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    
    public ObservableCollection<ThemeOptionViewModel> Options { get; } = new();

    public ThemeSettingViewModel(IThemeService themeService, string title, string description)
    {
        _themeService = themeService;
        _title = title;
        _description = description;

        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        var currentTheme = await _themeService.GetCurrentThemeAsync();
        var allThemes = await _themeService.GetAllThemesAsync();

        foreach (var theme in allThemes)
        {
            Options.Add(new ThemeOptionViewModel(theme, theme.Name == currentTheme, this));
        }
    }

    public async Task SelectThemeAsync(string themeName)
    {
        foreach (var option in Options)
        {
            option.IsSelected = option.Name == themeName;
        }
        await _themeService.ApplyThemeAsync(themeName);
    }
}

