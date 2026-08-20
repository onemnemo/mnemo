using System.Collections.ObjectModel;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.HeadlessShell;

/// <summary>
/// Collects the module sidebar registrations and exposes them as an ordered nav
/// model for the SPA (served by the nav endpoint). The SPA owns rendering and
/// localization, so labels stay as translation keys here - nothing is resolved to
/// a string server-side. Category order and footer placement are defined by
/// <see cref="DefaultCategoryOrder"/> and <see cref="FooterCategoryKeys"/> below.
/// <see cref="Categories"/> and <see cref="SetItemBadge"/> are not
/// used server-side (the SPA renders from the nav model); badges land with the UI
/// that needs them.
/// </summary>
public sealed class HeadlessSidebarService : ISidebarService
{
    private static readonly Dictionary<string, int> DefaultCategoryOrder = new(StringComparer.OrdinalIgnoreCase)
    {
        { "MainHub", 0 },
        { "Modules", 1 },
        { "Ecosystem", 2 },
    };

    private static readonly HashSet<string> FooterCategoryKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Ecosystem",
    };

    private readonly List<Registration> _registrations = new();

    public ObservableCollection<SidebarCategory> Categories { get; } = new();

    public bool IsCollapsed { get; set; }

    public void RegisterItem(string labelKey, string route, string icon, string categoryKey = "General",
        int? categoryOrder = null, int itemOrder = int.MaxValue, string ns = "Sidebar",
        SidebarItemVisibilityRequirement visibilityRequirement = SidebarItemVisibilityRequirement.None,
        string[]? childRoutes = null)
    {
        _registrations.Add(new Registration(
            labelKey, route, icon, categoryKey, categoryOrder, itemOrder, ns, visibilityRequirement,
            childRoutes ?? []));
    }

    public void SetItemBadge(string route, string? badgeText) { }

    /// <summary>The registered items grouped into ordered categories, mirroring SidebarService.</summary>
    public IReadOnlyList<NavCategoryModel> BuildNavModel()
    {
        var categories = new List<CategoryAccumulator>();
        foreach (var reg in _registrations)
        {
            var category = categories.FirstOrDefault(c =>
                string.Equals(c.Key, reg.CategoryKey, StringComparison.OrdinalIgnoreCase) && c.Ns == reg.Ns);
            if (category is null)
            {
                var order = reg.CategoryOrder
                    ?? (DefaultCategoryOrder.TryGetValue(reg.CategoryKey, out var known) ? known : int.MaxValue);
                category = new CategoryAccumulator(reg.CategoryKey, reg.Ns, order, FooterCategoryKeys.Contains(reg.CategoryKey));
                categories.Add(category);
            }

            category.Items.Add(reg);
        }

        // OrderBy is stable, so items sharing an order keep registration order.
        return categories
            .OrderBy(c => c.Order)
            .Select(c => new NavCategoryModel(
                c.Key,
                c.Ns,
                c.Order,
                c.Footer,
                c.Items
                    .OrderBy(i => i.ItemOrder)
                    .Select(i => new NavItemModel(i.LabelKey, i.Route, i.Icon, i.ItemOrder, i.Ns, i.Visibility, i.ChildRoutes))
                    .ToList()))
            .ToList();
    }

    private sealed record Registration(
        string LabelKey, string Route, string Icon, string CategoryKey, int? CategoryOrder, int ItemOrder,
        string Ns, SidebarItemVisibilityRequirement Visibility, IReadOnlyList<string> ChildRoutes);

    private sealed class CategoryAccumulator
    {
        public CategoryAccumulator(string key, string ns, int order, bool footer)
        {
            Key = key;
            Ns = ns;
            Order = order;
            Footer = footer;
        }

        public string Key { get; }
        public string Ns { get; }
        public int Order { get; }
        public bool Footer { get; }
        public List<Registration> Items { get; } = new();
    }
}

/// <summary>An ordered sidebar category of nav items, with translation keys unresolved.</summary>
public sealed record NavCategoryModel(string Key, string Ns, int Order, bool Footer, IReadOnlyList<NavItemModel> Items);

/// <summary>One sidebar item; <see cref="Icon"/> is the raw resource path from the module registration.</summary>
public sealed record NavItemModel(
    string LabelKey, string Route, string Icon, int Order, string Ns,
    SidebarItemVisibilityRequirement Visibility, IReadOnlyList<string> ChildRoutes);
