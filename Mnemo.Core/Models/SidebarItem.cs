using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;

namespace Mnemo.Core.Models;

public partial class SidebarItem : ObservableObject
{
    [ObservableProperty]
    private string _label;

    public string Route { get; }
    public string Icon { get; }
    public string Title => Label;
    public string IconPath => Icon;
    public int Order { get; }

    /// <summary>
    /// Additional routes (sub-pages) that should also highlight this sidebar item as active.
    /// </summary>
    public IReadOnlySet<string> ChildRoutes { get; }

    [ObservableProperty]
    private bool _isSelected;

    [ObservableProperty]
    private bool _isVisible = true;

    /// <summary>Small indicator on the sidebar row (e.g. update available after prompt cap).</summary>
    [ObservableProperty]
    private bool _showUpdateBadge;

    /// <summary>Optional count/label pill on the sidebar row (e.g. flashcards due count). Hidden when null/empty.</summary>
    [ObservableProperty]
    private string? _badgeText;

    public SidebarItem(string label, string route, string icon, int order = int.MaxValue, IEnumerable<string>? childRoutes = null)
    {
        _label = label;
        Route = route;
        Icon = icon;
        Order = order;
        ChildRoutes = childRoutes != null
            ? new HashSet<string>(childRoutes, StringComparer.OrdinalIgnoreCase)
            : (IReadOnlySet<string>)new HashSet<string>();
    }
}

public partial class SidebarCategory : ObservableObject
{
    [ObservableProperty]
    private string _name;

    public int Order { get; }
    public ObservableCollection<SidebarItem> Items { get; } = new();

    /// <summary>
    /// When true, this category renders in the sidebar footer (bottom, no section header),
    /// alongside the Quick actions button (e.g. Settings). Otherwise it renders in the
    /// main scrollable nav list with a section header.
    /// </summary>
    public bool IsFooter { get; }

    public SidebarCategory(string name, int order = int.MaxValue, bool isFooter = false)
    {
        _name = name;
        Order = order;
        IsFooter = isFooter;
    }
}
