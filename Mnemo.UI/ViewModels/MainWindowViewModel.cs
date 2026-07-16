using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.UI.Services;

namespace Mnemo.UI.ViewModels;

public partial class MainWindowViewModel : ViewModelBase
{
    private readonly ISettingsService _settingsService;

    public INavigationService Navigation { get; }
    public ISidebarService Sidebar { get; }
    public IOverlayService OverlayService { get; }
    /// <summary>Concrete toast host state (also exposed as <see cref="IToastService"/>).</summary>
    public ToastService ToastPresenter { get; }
    public Components.Sidebar.SidebarViewModel SidebarViewModel { get; }
    public Components.TopbarViewModel TopbarViewModel { get; }

    [ObservableProperty]
    private string _appIconPath = "avares://Mnemo.UI/Assets/AppIcons/AppIconDawn.ico";

    public MainWindowViewModel(
        INavigationService navigation,
        ISidebarService sidebar,
        Components.Sidebar.SidebarViewModel sidebarViewModel,
        Components.TopbarViewModel topbarViewModel,
        ISettingsService settingsService,
        IOverlayService overlayService,
        ToastService toastPresenter)
    {
        Navigation = navigation;
        Sidebar = sidebar;
        SidebarViewModel = sidebarViewModel;
        TopbarViewModel = topbarViewModel;
        OverlayService = overlayService;
        ToastPresenter = toastPresenter;
        _settingsService = settingsService;

        _ = LoadSettingsAsync();

        _settingsService.SettingChanged += (s, key) =>
        {
            if (key == "App.Icon")
                _ = LoadSettingsAsync();
        };
    }

    private async Task LoadSettingsAsync()
    {
        AppIconPath = await _settingsService.GetAsync("App.Icon", "avares://Mnemo.UI/Assets/AppIcons/AppIconDawn.ico");
    }
}
