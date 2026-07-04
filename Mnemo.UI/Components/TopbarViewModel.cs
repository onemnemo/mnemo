using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.UI.Components.Overlays;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Mnemo.Core.Services.Search;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Components;

public partial class TopbarViewModel : ViewModelBase
{
    private readonly ISettingsService _settingsService;
    private readonly IOverlayService _overlayService;
    private readonly IStatisticsManager _statistics;
    private readonly ILoggerService _logger;
    private readonly INavigationService _navigation;
    private readonly ILocalizationService _localization;
    private readonly IGlobalSearchService _globalSearchService;
    private readonly IToastService _toastService;
    private readonly IKeyMap _keyMap;

    public ObservableCollection<TopbarButtonModel> Buttons { get; } = new();

    public ObservableCollection<NotificationFlyoutRowViewModel> RecentNotifications { get; } = new();

    [ObservableProperty]
    private bool _isGamificationEnabled;

    [ObservableProperty]
    private string _profilePicturePath = "avares://Mnemo.UI/Assets/ProfilePictures/img2.png";

    /// <summary>Lifetime XP from <see cref="AppStatKinds.LifetimeTotals"/> (<c>total_xp</c>).</summary>
    [ObservableProperty]
    private string _gamificationXpText = string.Empty;

    /// <summary>Current practice streak from flashcard lifetime totals (<c>current_streak_days</c>).</summary>
    [ObservableProperty]
    private string _gamificationStreakText = string.Empty;

    [ObservableProperty]
    private string _globalSearchShortcutDisplay = string.Empty;

    public TopbarViewModel(
        ISettingsService settingsService,
        IOverlayService overlayService,
        IStatisticsManager statistics,
        ILoggerService logger,
        INavigationService navigation,
        ILocalizationService localization,
        IGlobalSearchService globalSearchService,
        IToastService toastService,
        IKeyMap keyMap)
    {
        _settingsService = settingsService;
        _overlayService = overlayService;
        _statistics = statistics;
        _logger = logger;
        _navigation = navigation;
        _localization = localization;
        _globalSearchService = globalSearchService;
        _toastService = toastService;
        _keyMap = keyMap;

        _toastService.NotificationHistoryChanged += (_, _) => Dispatcher.UIThread.Post(RefreshRecentNotifications);
        RefreshRecentNotifications();

        // Initial load
        _isGamificationEnabled = _settingsService.GetAsync("App.EnableGamification", true).GetAwaiter().GetResult();
        _profilePicturePath = _settingsService.GetAsync("User.ProfilePicture", "avares://Mnemo.UI/Assets/ProfilePictures/img2.png").GetAwaiter().GetResult();
        ApplyGamificationLocalizedDefaults();
        _ = RefreshGamificationFromAnalyticsAsync();

        _navigation.Navigated += (_, _) => _ = RefreshGamificationFromAnalyticsAsync();
        _localization.LanguageChanged += (_, _) =>
        {
            ApplyGamificationLocalizedDefaults();
            _ = RefreshGamificationFromAnalyticsAsync();
        };

        _keyMap.MergedDefinitionsChanged += (_, _) =>
            Dispatcher.UIThread.Post(RefreshGlobalSearchShortcutDisplay);
        RefreshGlobalSearchShortcutDisplay();

        // Listen for changes
        _settingsService.SettingChanged += (s, key) =>
        {
            if (key == "App.EnableGamification")
            {
                IsGamificationEnabled = _settingsService.GetAsync("App.EnableGamification", true).GetAwaiter().GetResult();
            }
            else if (key == "User.ProfilePicture")
            {
                ProfilePicturePath = _settingsService.GetAsync("User.ProfilePicture", "avares://Mnemo.UI/Assets/ProfilePictures/img2.png").GetAwaiter().GetResult();
            }
        };
    }

    public bool HasNotifications => RecentNotifications.Count > 0;

    public bool ShowsNotificationsEmpty => RecentNotifications.Count == 0;

    private void RefreshRecentNotifications()
    {
        RecentNotifications.Clear();
        foreach (var e in _toastService.GetRecentNotifications(6))
            RecentNotifications.Add(new NotificationFlyoutRowViewModel(e));
        OnPropertyChanged(nameof(HasNotifications));
        OnPropertyChanged(nameof(ShowsNotificationsEmpty));
    }

    private void ApplyGamificationLocalizedDefaults()
    {
        GamificationXpText = string.Format(_localization.T("GamificationXpFormat", "Topbar"), 0);
        GamificationStreakText = string.Format(_localization.T("GamificationStreakFormat", "Topbar"), 0);
    }

    private void RefreshGlobalSearchShortcutDisplay() =>
        GlobalSearchShortcutDisplay = KeybindActionShortcutLabel.ForAction(_keyMap, "global.search");

    private async Task RefreshGamificationFromAnalyticsAsync()
    {
        try
        {
            var flashTotals = (await _statistics.GetAsync(
                    StatisticsNamespaces.Flashcards,
                    FlashcardStatKinds.LifetimeTotals,
                    "all").ConfigureAwait(false))
                .Value;
            var streak = ReadInt(flashTotals, "current_streak_days");

            var appTotals = (await _statistics.GetAsync(
                    StatisticsNamespaces.App,
                    AppStatKinds.LifetimeTotals,
                    "all").ConfigureAwait(false))
                .Value;
            var xp = ReadInt(appTotals, "total_xp");

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                GamificationXpText = string.Format(_localization.T("GamificationXpFormat", "Topbar"), xp);
                GamificationStreakText = string.Format(_localization.T("GamificationStreakFormat", "Topbar"), streak);
            });
        }
        catch (System.Exception ex)
        {
            _logger?.Error("Topbar", "Loading gamification stats from analytics failed.", ex);
            await Dispatcher.UIThread.InvokeAsync(ApplyGamificationLocalizedDefaults);
        }
    }

    private static long ReadInt(StatisticsRecord? record, string field)
    {
        if (record == null) return 0L;
        return record.Fields.TryGetValue(field, out var v) && v.Type == StatValueType.Integer
            ? v.AsInt()
            : 0L;
    }

    [RelayCommand]
    private async Task CloseAsync()
    {
        var result = await _overlayService.CreateDialogAsync(
            _localization.T("ConfirmExitTitle", "Topbar"),
            _localization.T("ConfirmExitMessage", "Topbar"),
            _localization.T("ConfirmExitButton", "Topbar"),
            _localization.T("Cancel", "Common")
        );

        if (result == _localization.T("ConfirmExitButton", "Topbar"))
        {
            if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            {
                desktop.Shutdown();
            }
        }
    }

    [RelayCommand]
    private void Minimize()
    {
        if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow!.WindowState = Avalonia.Controls.WindowState.Minimized;
        }
    }

    [RelayCommand]
    private void Maximize()
    {
        if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow!.WindowState = desktop.MainWindow.WindowState == Avalonia.Controls.WindowState.Maximized
                ? Avalonia.Controls.WindowState.Normal
                : Avalonia.Controls.WindowState.Maximized;
        }
    }

    [RelayCommand]
    private void OpenProfileSettings() => _navigation.NavigateTo("settings");

    /// <summary>When global search is open, closes it; otherwise opens it. Used when <see cref="KeybindActionDefinition.ToggleOnRepeat"/> is set.</summary>
    public void TryToggleGlobalSearch()
    {
        var existing = _overlayService.Overlays.FirstOrDefault(o => o.Name == "GlobalSearch");
        if (existing != null)
        {
            _overlayService.CloseOverlay(existing.Id);
            return;
        }

        OpenGlobalSearch();
    }

    [RelayCommand]
    private void OpenGlobalSearch()
    {
        if (_overlayService.Overlays.Any(o => o.Name == "GlobalSearch"))
        {
            return;
        }

        var overlay = new GlobalSearchOverlay(
            _globalSearchService,
            _navigation,
            _localization,
            _localization.T("SearchPlaceholder", "Topbar"));
        string? overlayId = null;
        overlay.OnClose = () =>
        {
            if (!string.IsNullOrWhiteSpace(overlayId))
            {
                _overlayService.CloseOverlay(overlayId);
            }
        };

        overlayId = _overlayService.CreateOverlay(overlay, new OverlayOptions
        {
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Top,
            Margin = new Thickness(0, 84, 0, 0),
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            CloseOnEscape = true
        }, "GlobalSearch");
    }
}



