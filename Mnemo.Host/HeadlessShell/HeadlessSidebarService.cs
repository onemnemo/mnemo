using System.Collections.ObjectModel;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Inert sidebar service. The SPA owns its sidebar; module sidebar registrations
/// are not replayed server-side, so the category list stays empty.
/// </summary>
public sealed class HeadlessSidebarService : ISidebarService
{
    public ObservableCollection<SidebarCategory> Categories { get; } = new();

    public bool IsCollapsed { get; set; }

    public void RegisterItem(string labelKey, string route, string icon, string categoryKey = "General",
        int? categoryOrder = null, int itemOrder = int.MaxValue, string ns = "Sidebar",
        SidebarItemVisibilityRequirement visibilityRequirement = SidebarItemVisibilityRequirement.None,
        string[]? childRoutes = null)
    { }

    public void SetItemBadge(string route, string? badgeText) { }
}
