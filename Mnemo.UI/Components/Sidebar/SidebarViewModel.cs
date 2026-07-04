using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Threading.Tasks;
using System.Windows.Input;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;
using System.Linq;

namespace Mnemo.UI.Components.Sidebar;

public class SidebarViewModel : ViewModelBase
{
    private readonly ISidebarService _sidebarService;
    private readonly INavigationService _navigationService;
    private readonly IOverlayService _overlayService;
    private readonly IKeyMap _keyMap;
    private readonly IMainThreadDispatcher _mainThreadDispatcher;

    public ObservableCollection<SidebarCategory> Categories => _sidebarService.Categories;

    public bool IsSidebarCollapsed
    {
        get => _sidebarService.IsCollapsed;
        set => _sidebarService.IsCollapsed = value;
    }

    public ICommand ToggleSidebarCommand { get; }
    public ICommand NavigateCommand { get; }
    public ICommand OpenKeybindManagerCommand { get; }

    /// <summary>Shows the build-channel footer label only on debug or pre-release builds.</summary>
    public static bool IsDevelopmentBuild
    {
        get
        {
#if DEBUG
            return true;
#else
            return AppVersion.GetVersion().Contains('-');
#endif
        }
    }

    /// <summary>
    /// Compact version label for the sidebar footer, e.g. "Alpha 0.6.5". The pre-release
    /// suffix (e.g. "-dev") is trimmed; "Alpha" is the current release channel while the
    /// app is on a 0.x version.
    /// </summary>
    public static string VersionDisplay
    {
        get
        {
            // Trim any pre-release ("-dev") or build-metadata ("+<hash>") suffix, keeping just "major.minor.patch".
            var version = AppVersion.GetVersion();
            var cut = version.IndexOfAny(['-', '+']);
            if (cut >= 0)
                version = version[..cut];
            return $"Alpha {version}";
        }
    }

    private string _quickActionsShortcutDisplay = string.Empty;

    public string QuickActionsShortcutDisplay
    {
        get => _quickActionsShortcutDisplay;
        private set => SetProperty(ref _quickActionsShortcutDisplay, value);
    }

    public SidebarViewModel(
        ISidebarService sidebarService,
        INavigationService navigationService,
        IOverlayService overlayService,
        IKeyMap keyMap,
        IMainThreadDispatcher mainThreadDispatcher)
    {
        _sidebarService = sidebarService;
        _navigationService = navigationService;
        _overlayService = overlayService;
        _keyMap = keyMap;
        _mainThreadDispatcher = mainThreadDispatcher;

        ToggleSidebarCommand = new RelayCommand(() => IsSidebarCollapsed = !IsSidebarCollapsed);
        NavigateCommand = new RelayCommand<SidebarItem>(NavigateToItem);
        OpenKeybindManagerCommand = new RelayCommand(() => _ = OpenKeybindManagerAsync());

        if (_sidebarService is INotifyPropertyChanged npc)
        {
            npc.PropertyChanged += (s, e) =>
            {
                if (e.PropertyName == nameof(ISidebarService.IsCollapsed))
                {
                    OnPropertyChanged(nameof(IsSidebarCollapsed));
                }
            };
        }

        if (_navigationService is INotifyPropertyChanged navNpc)
        {
            navNpc.PropertyChanged += (s, e) =>
            {
                if (e.PropertyName == nameof(INavigationService.CurrentViewModel))
                {
                    UpdateSelection();
                }
            };
        }
        
        // Set initial selection
        UpdateSelection();

        QuickActionsShortcutDisplay = KeybindActionShortcutLabel.ForAction(_keyMap, "global.quick-actions");
        _keyMap.MergedDefinitionsChanged += (_, _) => _ = RefreshQuickActionsShortcutDisplayAsync();
    }

    private async Task RefreshQuickActionsShortcutDisplayAsync()
    {
        await _mainThreadDispatcher.InvokeAsync(() =>
        {
            QuickActionsShortcutDisplay = KeybindActionShortcutLabel.ForAction(_keyMap, "global.quick-actions");
            return Task.CompletedTask;
        }).ConfigureAwait(false);
    }

    private async Task OpenKeybindManagerAsync()
    {
        await _mainThreadDispatcher.InvokeAsync(() =>
        {
            KeybindManagerUi.TryOpen(_overlayService, _keyMap);
            return Task.CompletedTask;
        }).ConfigureAwait(false);
    }

    private void NavigateToItem(SidebarItem? item)
    {
        if (item != null)
        {
            _navigationService.NavigateTo(item.Route);
        }
    }

    private void UpdateSelection()
    {
        var currentRoute = _navigationService.CurrentRoute;
        
        foreach (var category in Categories)
        {
            foreach (var item in category.Items)
            {
                item.IsSelected = item.Route == currentRoute
                    || item.ChildRoutes.Contains(currentRoute ?? string.Empty);
            }
        }
    }
}

