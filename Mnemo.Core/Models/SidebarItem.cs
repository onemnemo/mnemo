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

    public SidebarCategory(string name, int order = int.MaxValue)
    {
        _name = name;
        Order = order;
    }
}
