using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class LanguageSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ILocalizationService _localizationService;
    private readonly ISettingsService _settingsService;
    private bool _isInitializing;

    [ObservableProperty]
    private string _title = "Language";

    [ObservableProperty]
    private string _description = "Choose your preferred language.";

    [ObservableProperty]
    private LanguageManifest? _selectedLanguage;

    public ObservableCollection<LanguageManifest> AvailableLanguages { get; } = new();

    public LanguageSettingViewModel(ILocalizationService localizationService, ISettingsService settingsService)
    {
        _localizationService = localizationService;
        _settingsService = settingsService;
        _localizationService.LanguageChanged += OnLanguageChanged;
        _ = InitializeAsync();
    }

    private void OnLanguageChanged(object? sender, EventArgs e)
    {
        Title = _localizationService.T("Language", "Settings");
        Description = _localizationService.T("LanguageDescription", "Settings");
        OnPropertyChanged(nameof(Title));
        OnPropertyChanged(nameof(Description));
    }

    private async Task InitializeAsync()
    {
        _isInitializing = true;
        try
        {
            var manifests = await _localizationService.GetAvailableLanguagesAsync().ConfigureAwait(true);
            foreach (var m in manifests)
                AvailableLanguages.Add(m);

            var savedCode = await _settingsService.GetAsync<string>("App.Language", "en").ConfigureAwait(true) ?? "en";
            var match = AvailableLanguages.FirstOrDefault(m => string.Equals(m.Code, savedCode, StringComparison.OrdinalIgnoreCase));
            SelectedLanguage = match ?? AvailableLanguages.FirstOrDefault();

            Title = _localizationService.T("Language", "Settings");
            Description = _localizationService.T("LanguageDescription", "Settings");
        }
        finally
        {
            _isInitializing = false;
        }
    }

    partial void OnSelectedLanguageChanged(LanguageManifest? value)
    {
        if (value == null || _isInitializing) return;
        _ = _settingsService.SetAsync("App.Language", value.Code);
        _ = _localizationService.SetLanguageAsync(value.Code);
    }
}
