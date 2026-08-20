using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.UI.Modules.Overview.ViewModels;

/// <summary>
/// One row in the widget library: a registered widget type with its available sizes and an
/// Add action. Multiple instances of the same type may be added.
/// </summary>
public partial class WidgetLibraryItemViewModel : ObservableObject
{
    private readonly WidgetLibraryViewModel _owner;

    public WidgetManifest Manifest { get; }

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private string _description = string.Empty;

    /// <summary>Available sizes, e.g. "2×1 · 2×2".</summary>
    public string SizesText { get; }

    public string IconUri => Manifest.IconUri;

    public bool IsExtension => !Manifest.IsBuiltIn;

    /// <summary>Attribution line for extension widgets, e.g. "by @stud-tools".</summary>
    [ObservableProperty]
    private string _byline = string.Empty;

    /// <summary>How many instances of this type are currently on the board.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsOnGrid))]
    private string _onGridText = string.Empty;

    public bool IsOnGrid => !string.IsNullOrEmpty(OnGridText);

    /// <summary>Search haystack (title + description + author), culture-lowered lazily by the filter.</summary>
    public string SearchBlob => $"{Title} {Description} {Manifest.Author}";

    [ObservableProperty]
    private bool _isAdding;

    public WidgetLibraryItemViewModel(WidgetManifest manifest, WidgetLibraryViewModel owner)
    {
        Manifest = manifest;
        _owner = owner;
        SizesText = string.Join(" · ", manifest.SupportedSizes.Select(s => $"{s.Columns}×{s.Rows}"));
    }

    [RelayCommand]
    private async Task AddAsync()
    {
        IsAdding = true;
        try
        {
            await _owner.AddToBoardAsync(this);
        }
        finally
        {
            IsAdding = false;
        }
    }
}

/// <summary>
/// ViewModel for the widget library panel: registered widget types grouped into built-in and
/// extension sections, filtered by search. A view over <see cref="IWidgetRegistry"/>; adding
/// delegates to the board's ViewModel.
/// </summary>
public partial class WidgetLibraryViewModel : ObservableObject
{
    private readonly IWidgetRegistry _registry;
    private readonly ILocalizationService _localization;
    private readonly IOverlayService _overlayService;
    private readonly OverviewViewModel _board;
    private readonly List<WidgetLibraryItemViewModel> _allItems = new();
    private bool _notifiedClosed;

    /// <summary>Overlay id assigned after the panel is shown; used by the close button.</summary>
    public string OverlayId { get; set; } = string.Empty;

    /// <summary>Raised once when the panel leaves the screen (close button, Escape, or Done).</summary>
    public event EventHandler? Closed;

    public ObservableCollection<WidgetLibraryItemViewModel> BuiltInWidgets { get; } = new();

    public ObservableCollection<WidgetLibraryItemViewModel> ExtensionWidgets { get; } = new();

    [ObservableProperty]
    private string _searchQuery = string.Empty;

    [ObservableProperty]
    private bool _hasBuiltInWidgets;

    [ObservableProperty]
    private bool _hasExtensionWidgets;

    [ObservableProperty]
    private bool _hasNoResults;

    public WidgetLibraryViewModel(
        IWidgetRegistry registry,
        ILocalizationService localization,
        IOverlayService overlayService,
        OverviewViewModel board)
    {
        _registry = registry;
        _localization = localization;
        _overlayService = overlayService;
        _board = board;

        foreach (var descriptor in _registry.AvailableDescriptors)
            _allItems.Add(new WidgetLibraryItemViewModel(descriptor.Manifest, this));

        _localization.LanguageChanged += OnLanguageChanged;
        _board.Widgets.CollectionChanged += OnBoardChanged;

        RefreshLabels();
        ApplyFilter();
    }

    /// <summary>Unsubscribes from services; called when the panel closes.</summary>
    public void Detach()
    {
        _localization.LanguageChanged -= OnLanguageChanged;
        _board.Widgets.CollectionChanged -= OnBoardChanged;
    }

    /// <summary>Raises <see cref="Closed"/> exactly once; called by the view when it detaches.</summary>
    public void NotifyClosed()
    {
        if (_notifiedClosed)
            return;
        _notifiedClosed = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    internal Task AddToBoardAsync(WidgetLibraryItemViewModel item)
        => _board.AddWidgetAsync(item.Manifest);

    [RelayCommand]
    private void Close() => _overlayService.CloseOverlay(OverlayId);

    partial void OnSearchQueryChanged(string value) => ApplyFilter();

    private void OnLanguageChanged(object? sender, EventArgs e)
    {
        RefreshLabels();
        ApplyFilter();
    }

    private void OnBoardChanged(object? sender, NotifyCollectionChangedEventArgs e) => RefreshOnGridCounts();

    private void RefreshLabels()
    {
        foreach (var item in _allItems)
        {
            item.Title = _localization.T(item.Manifest.DisplayNameKey, item.Manifest.TranslationNamespace);
            item.Description = _localization.T(item.Manifest.DescriptionKey, item.Manifest.TranslationNamespace);
            item.Byline = item.IsExtension
                ? string.Format(CultureInfo.CurrentCulture, _localization.T("BylineFormat", "WidgetLibrary"), item.Manifest.Author)
                : string.Empty;
        }

        RefreshOnGridCounts();
    }

    private void RefreshOnGridCounts()
    {
        foreach (var item in _allItems)
        {
            var count = _board.Widgets.Count(w => string.Equals(w.Instance.WidgetId, item.Manifest.WidgetId, StringComparison.Ordinal));
            item.OnGridText = count switch
            {
                0 => string.Empty,
                1 => _localization.T("OnGrid", "WidgetLibrary"),
                _ => string.Format(CultureInfo.CurrentCulture, _localization.T("OnGridCountFormat", "WidgetLibrary"), count)
            };
        }
    }

    private void ApplyFilter()
    {
        var query = SearchQuery.Trim();
        var comparer = CultureInfo.CurrentCulture.CompareInfo;
        const CompareOptions opts = CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace;

        bool Matches(WidgetLibraryItemViewModel item)
            => string.IsNullOrEmpty(query) || comparer.IndexOf(item.SearchBlob, query, opts) >= 0;

        BuiltInWidgets.Clear();
        ExtensionWidgets.Clear();

        foreach (var item in _allItems.Where(Matches))
        {
            if (item.IsExtension)
                ExtensionWidgets.Add(item);
            else
                BuiltInWidgets.Add(item);
        }

        HasBuiltInWidgets = BuiltInWidgets.Count > 0;
        HasExtensionWidgets = ExtensionWidgets.Count > 0;
        HasNoResults = BuiltInWidgets.Count == 0 && ExtensionWidgets.Count == 0;
    }
}
