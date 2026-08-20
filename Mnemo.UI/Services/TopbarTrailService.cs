using System;
using System.Collections.Generic;
using Mnemo.Core.Services;

namespace Mnemo.UI.Services;

/// <summary>
/// One module-supplied crumb rendered after the module label in the topbar trail
/// (e.g. "Geology" / "Plate Tectonics" after "Flashcards"). A crumb with a
/// <see cref="Route"/> navigates on click; without one it renders as inert text.
/// </summary>
public sealed record TopbarTrailCrumb(string Title, string? Route = null, object? Parameter = null);

/// <summary>
/// Lets the current page publish a hierarchy trail ("where am I inside the module") into the
/// topbar, next to the sidebar-resolved module label. The trail is cleared automatically on every
/// navigation, so pages must set it after their navigation completes, typically from the async
/// load that resolves the names, never synchronously inside <c>OnNavigatedTo</c>.
/// </summary>
public interface ITopbarTrailService
{
    /// <summary>Crumbs appended after the module label; empty when the page has no trail.</summary>
    IReadOnlyList<TopbarTrailCrumb> Crumbs { get; }

    /// <summary>Raised on any thread whenever <see cref="Crumbs"/> changes; consumers marshal to the UI thread.</summary>
    event EventHandler? TrailChanged;

    void SetTrail(IReadOnlyList<TopbarTrailCrumb> crumbs);

    void ClearTrail();
}

public sealed class TopbarTrailService : ITopbarTrailService
{
    private static readonly IReadOnlyList<TopbarTrailCrumb> Empty = Array.Empty<TopbarTrailCrumb>();

    public TopbarTrailService(INavigationService navigation)
    {
        // A trail describes exactly one page; any navigation invalidates it. Navigated fires after
        // the new view model's OnNavigatedTo, which is why trails must be set asynchronously.
        navigation.Navigated += (_, _) => ClearTrail();
    }

    public IReadOnlyList<TopbarTrailCrumb> Crumbs { get; private set; } = Empty;

    public event EventHandler? TrailChanged;

    public void SetTrail(IReadOnlyList<TopbarTrailCrumb> crumbs)
    {
        ArgumentNullException.ThrowIfNull(crumbs);
        Crumbs = crumbs;
        TrailChanged?.Invoke(this, EventArgs.Empty);
    }

    public void ClearTrail()
    {
        if (Crumbs.Count == 0)
            return;
        Crumbs = Empty;
        TrailChanged?.Invoke(this, EventArgs.Empty);
    }
}
