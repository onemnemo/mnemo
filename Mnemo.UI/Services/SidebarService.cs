using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Collections.Generic;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Services;

public class SidebarService : ISidebarService, INotifyPropertyChanged
{
    public const string AiAssistantEnabledKey = "AI.EnableAssistant";

    private bool _isCollapsed;
    private readonly ILocalizationService _localizationService;
    private readonly ISettingsService _settingsService;

    private static readonly Dictionary<string, int> DefaultCategoryOrder = new(StringComparer.OrdinalIgnoreCase)
    {
        { "MainHub", 0 },
        { "Modules", 1 },
        { "Ecosystem", 2 }
    };

    /// <summary>Category keys rendered in the sidebar footer (bottom, no section header) rather than the main nav list.</summary>
    private static readonly HashSet<string> FooterCategoryKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Ecosystem"
    };

    private readonly List<(SidebarCategory category, string nameKey, string ns)> _categoryKeys = new();
    private readonly List<(SidebarItem item, string labelKey, string ns)> _itemKeys = new();
    private readonly List<(SidebarItem item, SidebarItemVisibilityRequirement requirement)> _visibilityItems = new();

    public ObservableCollection<SidebarCategory> Categories { get; } = new();

    public bool IsCollapsed
    {
        get => _isCollapsed;
        set
        {
            if (_isCollapsed != value)
            {
                _isCollapsed = value;
                OnPropertyChanged();
            }
        }
    }

    public SidebarService(ILocalizationService localizationService, ISettingsService settingsService)
    {
        _localizationService = localizationService;
        _settingsService = settingsService;
        _localizationService.LanguageChanged += OnLanguageChanged;
        _settingsService.SettingChanged += OnSettingChanged;
    }

    private void OnSettingChanged(object? sender, string key)
    {
        if (key != AiAssistantEnabledKey)
            return;
        ApplyAssistantVisibility();
    }

    private void ApplyAssistantVisibility()
    {
        var aiOn = _settingsService.GetAsync(AiAssistantEnabledKey, false).GetAwaiter().GetResult();
        foreach (var (item, requirement) in _visibilityItems)
        {
            if (requirement == SidebarItemVisibilityRequirement.AiAssistantEnabled)
                item.IsVisible = aiOn;
        }
    }

    private void OnLanguageChanged(object? sender, EventArgs e)
    {
        foreach (var (category, nameKey, ns) in _categoryKeys)
            category.Name = _localizationService.T(nameKey, ns);
        foreach (var (item, labelKey, ns) in _itemKeys)
            item.Label = _localizationService.T(labelKey, ns);
    }

    public void RegisterItem(string labelKey, string route, string icon, string categoryKey = "General", int? categoryOrder = null, int itemOrder = int.MaxValue, string ns = "Sidebar", SidebarItemVisibilityRequirement visibilityRequirement = SidebarItemVisibilityRequirement.None, string[]? childRoutes = null)
    {
        var category = _categoryKeys.FirstOrDefault(t => string.Equals(t.nameKey, categoryKey, StringComparison.OrdinalIgnoreCase) && t.ns == ns).category;
        if (category == null)
        {
            var order = categoryOrder ??
                       (DefaultCategoryOrder.TryGetValue(categoryKey, out var defaultOrder) ? defaultOrder : int.MaxValue);
            var resolvedCategoryName = _localizationService.T(categoryKey, ns);
            category = new SidebarCategory(resolvedCategoryName, order, FooterCategoryKeys.Contains(categoryKey));
            _categoryKeys.Add((category, categoryKey, ns));

            var insertIndex = Categories.Count;
            for (int i = 0; i < Categories.Count; i++)
            {
                if (Categories[i].Order > order)
                {
                    insertIndex = i;
                    break;
                }
            }
            Categories.Insert(insertIndex, category);
        }

        var resolvedLabel = _localizationService.T(labelKey, ns);
        var item = new SidebarItem(resolvedLabel, route, icon, itemOrder, childRoutes);
        _itemKeys.Add((item, labelKey, ns));

        if (visibilityRequirement != SidebarItemVisibilityRequirement.None)
        {
            _visibilityItems.Add((item, visibilityRequirement));
            if (visibilityRequirement == SidebarItemVisibilityRequirement.AiAssistantEnabled)
                item.IsVisible = _settingsService.GetAsync(AiAssistantEnabledKey, false).GetAwaiter().GetResult();
        }

        var itemInsertIndex = category.Items.Count;
        for (int i = 0; i < category.Items.Count; i++)
        {
            if (category.Items[i].Order > itemOrder)
            {
                itemInsertIndex = i;
                break;
            }
        }
        category.Items.Insert(itemInsertIndex, item);
    }

    public void SetItemBadge(string route, string? badgeText)
    {
        var normalized = string.IsNullOrWhiteSpace(badgeText) ? null : badgeText;
        foreach (var category in Categories)
        {
            foreach (var item in category.Items)
            {
                if (string.Equals(item.Route, route, StringComparison.OrdinalIgnoreCase))
                {
                    item.BadgeText = normalized;
                    return;
                }
            }
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

