using System.Collections.ObjectModel;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Server-side stand-in for the navigation service. Routes registered by modules
/// are recorded (they become the SPA's route metadata later); navigation calls are
/// inert until the app-events channel exists to push them to the SPA as events.
/// </summary>
public sealed class HeadlessNavigationService : INavigationService
{
    private readonly Dictionary<string, Type> _routes = new(StringComparer.Ordinal);

    public IReadOnlyDictionary<string, Type> Routes => _routes;

    public object? CurrentViewModel => null;
    public string? CurrentRoute => null;
    public bool CanGoBack => false;
    public event Action? CanGoBackChanged { add { } remove { } }
    public event EventHandler<NavigationChangedEventArgs>? Navigated { add { } remove { } }
    public ObservableCollection<BreadcrumbItem> Breadcrumbs { get; } = new();

    public void RegisterRoute(string route, Type viewModelType) => _routes[route] = viewModelType;
    public void NavigateTo(string route) { }
    public void NavigateTo(string route, object? parameter) { }
    public void NavigateToBreadcrumb(BreadcrumbItem item) { }
}
