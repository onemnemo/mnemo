using System.Threading.Tasks;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Services;
using Mnemo.UI.Services;

namespace Mnemo.UI.ViewModels;

public partial class MainWindowViewModel : ViewModelBase
{
    private const string AssistantEnabledKey = "AI.EnableAssistant";

    private readonly ISettingsService _settingsService;
    private readonly IAssistantOverlayService _assistant;

    public INavigationService Navigation { get; }
    public ISidebarService Sidebar { get; }
    public IOverlayService OverlayService { get; }
    /// <summary>Concrete toast host state (also exposed as <see cref="IToastService"/>).</summary>
    public ToastService ToastPresenter { get; }
    public Components.Sidebar.SidebarViewModel SidebarViewModel { get; }
    public Components.TopbarViewModel TopbarViewModel { get; }

    /// <summary>Opens the centralized AI assistant (compact Ask overlay) from anywhere.</summary>
    public ICommand OpenAssistantCommand { get; }

    [ObservableProperty]
    private bool _isAssistantEnabled = true;

    [ObservableProperty]
    private string _appIconPath = "avares://Mnemo.UI/Assets/AppIcons/AppIconDawn.ico";

    public MainWindowViewModel(
        INavigationService navigation,
        ISidebarService sidebar,
        Components.Sidebar.SidebarViewModel sidebarViewModel,
        Components.TopbarViewModel topbarViewModel,
        ISettingsService settingsService,
        IOverlayService overlayService,
        IAssistantOverlayService assistant,
        ToastService toastPresenter)
    {
        Navigation = navigation;
        Sidebar = sidebar;
        SidebarViewModel = sidebarViewModel;
        TopbarViewModel = topbarViewModel;
        OverlayService = overlayService;
        ToastPresenter = toastPresenter;
        _settingsService = settingsService;
        _assistant = assistant;

        OpenAssistantCommand = new RelayCommand(() => _assistant.OpenAsk());

        _ = LoadSettingsAsync();

        _settingsService.SettingChanged += (s, key) =>
        {
            if (key == "App.Icon")
                _ = LoadSettingsAsync();
            else if (key == AssistantEnabledKey)
                _ = LoadAssistantEnabledAsync();
        };
    }

    private async Task LoadSettingsAsync()
    {
        AppIconPath = await _settingsService.GetAsync("App.Icon", "avares://Mnemo.UI/Assets/AppIcons/AppIconDawn.ico");
        await LoadAssistantEnabledAsync();
    }

    private async Task LoadAssistantEnabledAsync()
    {
        IsAssistantEnabled = await _settingsService.GetAsync(AssistantEnabledKey, true);
    }
}
