using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Services;

public class NavigationService : INavigationService, INotifyPropertyChanged
{
    public const string AiAssistantEnabledKey = "AI.EnableAssistant";

    private static readonly HashSet<string> AiAssistantGatedRoutes = new(StringComparer.Ordinal)
    {
        "chat",
    };

    private readonly IServiceProvider _serviceProvider;
    private readonly ISettingsService _settingsService;
    private readonly Dictionary<string, Type> _routes = new();
    private readonly Dictionary<string, string> _routeNames = new();
    private object? _currentViewModel;
    private readonly Stack<string> _history = new();
    // Cached snapshot of AI.EnableAssistant — read on every NavigateTo. Refreshed via SettingChanged
    // so we never block the UI thread on ISettingsService.GetAsync.
    private volatile bool _aiAssistantEnabled;

    public NavigationService(IServiceProvider serviceProvider, ISettingsService settingsService)
    {
        _serviceProvider = serviceProvider;
        _settingsService = settingsService;
        Breadcrumbs = new ObservableCollection<BreadcrumbItem>();
        _settingsService.SettingChanged += OnSettingsChanged;
        _ = InitializeAiAssistantFlagAsync();
    }

    private async System.Threading.Tasks.Task InitializeAiAssistantFlagAsync()
    {
        try
        {
            _aiAssistantEnabled = await _settingsService.GetAsync(AiAssistantEnabledKey, false).ConfigureAwait(false);
        }
        catch
        {
            _aiAssistantEnabled = false;
        }
    }

    private async void OnSettingsChanged(object? sender, string key)
    {
        if (key != AiAssistantEnabledKey)
            return;

        bool enabled;
        try
        {
            enabled = await _settingsService.GetAsync(AiAssistantEnabledKey, false).ConfigureAwait(true);
        }
        catch
        {
            enabled = false;
        }
        _aiAssistantEnabled = enabled;
        if (enabled)
            return;
        var route = CurrentRoute;
        if (route != null && AiAssistantGatedRoutes.Contains(route))
            ResetStackAndNavigateTo("overview", null);
    }

    private bool IsAiAssistantEnabled() => _aiAssistantEnabled;

    private void ResetStackAndNavigateTo(string route, object? parameter)
    {
        while (_history.Count > 0)
            _history.Pop();
        if (_currentViewModel is IDisposable disposable)
            disposable.Dispose();
        _currentViewModel = null;
        OnPropertyChanged(nameof(CurrentViewModel));
        OnPropertyChanged(nameof(CurrentRoute));
        UpdateBreadcrumbs();
        CanGoBackChanged?.Invoke();
        NavigateTo(route, parameter);
    }

    public object? CurrentViewModel
    {
        get => _currentViewModel;
        private set
        {
            if (_currentViewModel is IDisposable disposable)
            {
                disposable.Dispose();
            }

            _currentViewModel = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(CurrentRoute));
            UpdateBreadcrumbs();
        }
    }

    public string? CurrentRoute => _history.Count > 0 ? _history.Peek() : null;

    public bool CanGoBack => _history.Count > 1;

    public event Action? CanGoBackChanged;

    public event EventHandler<NavigationChangedEventArgs>? Navigated;

    public ObservableCollection<BreadcrumbItem> Breadcrumbs { get; }

    public void RegisterRoute(string route, Type viewModelType)
    {
        _routes[route] = viewModelType;
    }

    public void RegisterRoute(string route, Type viewModelType, string displayName)
    {
        _routes[route] = viewModelType;
        _routeNames[route] = displayName;
    }

    public void NavigateTo(string route)
    {
        NavigateTo(route, null);
    }

    public void NavigateTo(string route, object? parameter)
    {
        if (!IsAiAssistantEnabled() && AiAssistantGatedRoutes.Contains(route))
        {
            route = "overview";
            parameter = null;
            if (string.Equals(CurrentRoute, "overview", StringComparison.Ordinal))
                return;
        }

        if (_routes.TryGetValue(route, out var vmType))
        {
            var previousRoute = _history.Count > 0 ? _history.Peek() : null;
            var previousVm = CurrentViewModel;

            if (previousVm is INavigationAware previousAware)
            {
                previousAware.OnNavigatedFrom();
            }

            var keyMap = _serviceProvider.GetService<IKeyMap>();
            keyMap?.SetActiveRoute(route, RouteKeybindNamespaces.ForRoute(route));
            keyMap?.OnNavigationChanged();

            var vm = _serviceProvider.GetRequiredService(vmType);

            if (vm is INavigationAware aware)
            {
                aware.OnNavigatedTo(parameter);
            }

            if (keyMap != null && vm is IKeybindContributor contributor)
                contributor.RegisterEphemeralKeybinds(keyMap);

            _history.Push(route);
            CurrentViewModel = vm;
            CanGoBackChanged?.Invoke();

            Navigated?.Invoke(this, new NavigationChangedEventArgs
            {
                PreviousRoute = previousRoute,
                Route = route,
                PreviousViewModel = previousVm,
                ViewModel = vm
            });
        }
    }

    public void NavigateToBreadcrumb(BreadcrumbItem item)
    {
        NavigateTo(item.Route);
    }

    private void UpdateBreadcrumbs()
    {
        Breadcrumbs.Clear();
        if (_history.Count == 0) return;

        var routes = _history.ToList();
        routes.Reverse();

        for (int i = 0; i < routes.Count; i++)
        {
            var route = routes[i];
            var name = _routeNames.TryGetValue(route, out var displayName) ? displayName : route;
            Breadcrumbs.Add(new BreadcrumbItem
            {
                Title = name,
                Route = route,
                IsLast = i == routes.Count - 1
            });
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
