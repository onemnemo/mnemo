using System.Collections.ObjectModel;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

public interface ISidebarService
{
    ObservableCollection<SidebarCategory> Categories { get; }
    /// <summary>
    /// Registers a sidebar item. <paramref name="labelKey"/> and <paramref name="categoryKey"/> are translation keys
    /// in namespace <paramref name="ns"/> (default "Sidebar"). Supply <paramref name="childRoutes"/> to keep the item
    /// highlighted when the user navigates to a sub-page (e.g. a deck detail within the flashcards module).
    /// </summary>
    void RegisterItem(string labelKey, string route, string icon, string categoryKey = "General", int? categoryOrder = null, int itemOrder = int.MaxValue, string ns = "Sidebar", SidebarItemVisibilityRequirement visibilityRequirement = SidebarItemVisibilityRequirement.None, string[]? childRoutes = null);

    /// <summary>
    /// Sets (or clears, when <paramref name="badgeText"/> is null/empty) the count pill on the
    /// sidebar item for <paramref name="route"/>. No-op if the route is not registered.
    /// </summary>
    void SetItemBadge(string route, string? badgeText);

    bool IsCollapsed { get; set; }
}
