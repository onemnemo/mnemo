using System;
using System.Collections.ObjectModel;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

public partial class ProfilePictureSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ISettingsService _settingsService;
    private const string SettingKey = "User.ProfilePicture";
    private const string DefaultPicture = "avares://Mnemo.UI/Assets/ProfilePictures/img2.png";

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    
    [ObservableProperty] private string _currentPicturePath = DefaultPicture;

    public ObservableCollection<ProfilePictureOptionViewModel> Options { get; } = new();

    public ProfilePictureSettingViewModel(ISettingsService settingsService, string title, string description)
    {
        _settingsService = settingsService;
        _title = title;
        _description = description;

        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        // Load current asynchronously
        CurrentPicturePath = await _settingsService.GetAsync(SettingKey, DefaultPicture);

        // Initialize options
        for (int i = 0; i <= 5; i++)
        {
            var path = $"avares://Mnemo.UI/Assets/ProfilePictures/img{i}.png";
            Options.Add(new ProfilePictureOptionViewModel(path, path == CurrentPicturePath, this));
        }
    }

    public async Task SelectPictureAsync(string path)
    {
        CurrentPicturePath = path;
        foreach (var option in Options)
        {
            option.IsSelected = option.ImagePath == path;
        }
        await _settingsService.SetAsync(SettingKey, path);
    }
}
