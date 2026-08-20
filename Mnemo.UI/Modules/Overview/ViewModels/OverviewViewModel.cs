using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.Views;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Overview.ViewModels;

/// <summary>
/// ViewModel for the Overview dashboard: an ordered widget board packed by
/// <see cref="IWidgetLayoutEngine"/>. Edit mode operates on the live board as a draft:
/// entering edit snapshots the committed layout, Done persists the board, Cancel (or leaving
/// the page) restores the snapshot. Placement is order + span only; positions are computed.
/// </summary>
public partial class OverviewViewModel : ViewModelBase, INavigationAware, IWidgetBoardHost, IDisposable
{
    private const string UserDisplayNameKey = "User.DisplayName";

    /// <summary>Fresh-board template: two 2×1 tiles on row 0, 2×2 + two 1×2 tiles on row 1.</summary>
    private static readonly (string WidgetId, int Column, int Row, int Columns, int Rows)[] DefaultBoardTemplate =
    [
        ("mnemo.flashcard-stats", 0, 0, 2, 1),
        ("mnemo.recent-decks", 2, 0, 2, 1),
        ("mnemo.recent-notes", 0, 1, 2, 2),
        ("mnemo.study-goals", 2, 1, 1, 2),
        ("mnemo.usage-summary", 3, 1, 1, 2)
    ];

    private readonly IWidgetRegistry _widgetRegistry;
    private readonly IOverviewLayoutStore _layoutStore;
    private readonly IWidgetContext _widgetContext;
    private readonly IWidgetLayoutEngine _layoutEngine;
    private readonly IOverlayService _overlayService;
    private readonly ISettingsService _settingsService;
    private readonly ILocalizationService _localizationService;
    private readonly IDateDisplayService _dateDisplayService;
    private readonly ILoggerService _logger;

    // Serializes saves so a queued fire-and-forget save can never overwrite a newer one.
    private readonly SemaphoreSlim _saveSemaphore = new(1, 1);

    private readonly EventHandler _languageChangedHandler;

    private OverviewLayout? _editSnapshot;
    private WidgetHostViewModel? _draggedHost;
    private int _dragOriginColumn = -1;
    private int _dragOriginRow = -1;
    private string? _libraryOverlayId;
    private WidgetLibraryViewModel? _libraryViewModel;
    private bool _isDisposed;

    /// <summary>Widget tiles in board order. Order in this collection is the persisted order.</summary>
    public ObservableCollection<WidgetHostViewModel> Widgets { get; } = new();

    /// <summary>Packing engine handed to the board panel; all placement math goes through it.</summary>
    public IWidgetLayoutEngine LayoutEngine => _layoutEngine;

    [ObservableProperty]
    private bool _isEditMode;

    // Index of the tile being dragged (-1 = none); the board panel places it first so it keeps
    // the cell it was dropped on while the others yield around it.
    [ObservableProperty]
    private int _dragAnchorIndex = -1;

    // Floating drag ghost (follows the pointer; the tile's own slot renders the drop affordance).
    [ObservableProperty]
    private bool _isGhostVisible;

    [ObservableProperty]
    private double _ghostX;

    [ObservableProperty]
    private double _ghostY;

    [ObservableProperty]
    private string _ghostTitle = string.Empty;

    [ObservableProperty]
    private string _ghostSizeLabel = string.Empty;

    [ObservableProperty]
    private string _userName = string.Empty;


    /// <summary>True after the board has been loaded; avoids flashing the empty state during load.</summary>
    [ObservableProperty]
    private bool _isLayoutLoaded;

    /// <summary>True after the user profile has been loaded; avoids greeting flicker.</summary>
    [ObservableProperty]
    private bool _isProfileLoaded;

    /// <summary>Show the empty state only when loaded, empty, and not editing.</summary>
    public bool ShowEmptyState => IsLayoutLoaded && Widgets.Count == 0 && !IsEditMode;

    /// <summary>
    /// Time-of-day greeting, e.g. "Good evening, O. Malley". Uses the name-less variant when
    /// no display name is set (natural in every language). Empty until the profile is loaded.
    /// </summary>
    public string GreetingText
    {
        get
        {
            if (!IsProfileLoaded)
                return string.Empty;

            var key = DateTime.Now.Hour switch
            {
                >= 5 and < 12 => "GreetingMorning",
                >= 12 and < 18 => "GreetingAfternoon",
                _ => "GreetingEvening"
            };

            return string.IsNullOrWhiteSpace(UserName)
                ? _localizationService.T(key + "Short", "Overview")
                : string.Format(CultureInfo.CurrentCulture, _localizationService.T(key, "Overview"), UserName.Trim());
        }
    }

    /// <summary>Today's date line under the greeting, e.g. "Thursday, July 3".</summary>
    public string DateHeading => _dateDisplayService.FormatDayHeading(DateTime.Now);

    public OverviewViewModel(
        IWidgetRegistry widgetRegistry,
        IOverviewLayoutStore layoutStore,
        IWidgetContext widgetContext,
        IWidgetLayoutEngine layoutEngine,
        IOverlayService overlayService,
        ISettingsService settingsService,
        ILocalizationService localizationService,
        IDateDisplayService dateDisplayService,
        ILoggerService logger)
    {
        _widgetRegistry = widgetRegistry;
        _layoutStore = layoutStore;
        _widgetContext = widgetContext;
        _layoutEngine = layoutEngine;
        _overlayService = overlayService;
        _settingsService = settingsService;
        _localizationService = localizationService;
        _dateDisplayService = dateDisplayService;
        _logger = logger;

        _settingsService.SettingChanged += OnSettingChanged;
        _languageChangedHandler = (_, _) =>
        {
            OnPropertyChanged(nameof(GreetingText));
            OnPropertyChanged(nameof(DateHeading));
        };
        _localizationService.LanguageChanged += _languageChangedHandler;
        Widgets.CollectionChanged += (_, _) => OnPropertyChanged(nameof(ShowEmptyState));

        RunAndLogAsync(LoadLayoutAsync(), "load overview layout");
        RunAndLogAsync(LoadUserProfileAsync(), "load user profile");
    }

    /// <summary>Reloads widget data when the user returns to Overview so statistics stay current.</summary>
    public void OnNavigatedTo(object? parameter)
    {
        RunAndLogAsync(RefreshWidgetsAsync(), "refresh overview widgets");
    }

    // ----- Loading -----

    private async Task LoadLayoutAsync()
    {
        var result = await _layoutStore.LoadAsync().ConfigureAwait(false);

        await Dispatcher.UIThread.InvokeAsync(async () =>
        {
            if (!result.IsSuccess)
            {
                // Do not seed defaults over a load failure, that could clobber a real layout.
                _logger.Error("Overview", $"Failed to load overview layout: {result.ErrorMessage}", result.Exception);
                IsLayoutLoaded = true;
                return;
            }

            var layout = result.Value;
            var seededDefaults = layout == null;
            layout ??= CreateDefaultLayout();

            await PopulateBoardAsync(layout);
            IsLayoutLoaded = true;

            if (seededDefaults)
                RunAndLogAsync(SaveBoardAsync(), "save default overview layout");
        });
    }

    private OverviewLayout CreateDefaultLayout()
    {
        var layout = new OverviewLayout();
        foreach (var (widgetId, column, row, columns, rows) in DefaultBoardTemplate)
        {
            var manifest = _widgetRegistry.GetDescriptor(widgetId)?.Manifest;
            if (manifest == null)
                continue;

            var size = manifest.NearestSupportedSize(new WidgetSize(columns, rows));
            layout.Widgets.Add(new WidgetInstance
            {
                WidgetId = widgetId,
                Size = size,
                Column = column,
                Row = row,
                Order = layout.Widgets.Count,
                Settings = manifest.CreateDefaultSettings()
            });
        }

        return layout;
    }

    /// <summary>Rebuilds the board from a layout. Must run on the UI thread.</summary>
    private async Task PopulateBoardAsync(OverviewLayout layout)
    {
        DisposeHosts();
        Widgets.Clear();

        foreach (var instance in layout.Widgets.OrderBy(w => w.Order))
        {
            var host = await CreateHostAsync(instance.Clone());
            host.IsEditMode = IsEditMode;
            Widgets.Add(host);
        }

        foreach (var host in Widgets.ToList())
            await InitializeHostContentAsync(host);
    }

    private async Task<WidgetHostViewModel> CreateHostAsync(WidgetInstance instance)
    {
        var descriptor = _widgetRegistry.GetDescriptor(instance.WidgetId);
        if (descriptor == null)
        {
            _logger.Warning("Overview", $"No descriptor registered for widget '{instance.WidgetId}'; showing unavailable placeholder.");
            return new WidgetHostViewModel(instance, null, null, this);
        }

        try
        {
            var content = await descriptor.CreateViewModelAsync(instance, _widgetContext);
            return new WidgetHostViewModel(instance, descriptor.Manifest, content, this);
        }
        catch (Exception ex)
        {
            _logger.Error("Overview", $"Creating widget '{instance.WidgetId}' failed; showing unavailable placeholder.", ex);
            return new WidgetHostViewModel(instance, descriptor.Manifest, null, this);
        }
    }

    private async Task InitializeHostContentAsync(WidgetHostViewModel host)
    {
        if (host.Content == null)
            return;

        try
        {
            await host.Content.InitializeAsync();
        }
        catch (Exception ex)
        {
            _logger.Error("Overview", $"Initializing widget '{host.Instance.WidgetId}' failed.", ex);
        }
    }

    private async Task RefreshWidgetsAsync()
    {
        await Dispatcher.UIThread.InvokeAsync(async () =>
        {
            foreach (var host in Widgets.ToList())
            {
                if (host.Content == null)
                    continue;

                try
                {
                    await host.Content.RefreshAsync();
                }
                catch (Exception ex)
                {
                    _logger.Error("Overview", $"Refreshing widget '{host.Instance.WidgetId}' failed.", ex);
                }
            }
        });
    }

    // ----- Persistence -----

    private OverviewLayout BuildLayoutFromBoard()
    {
        var layout = new OverviewLayout();
        for (var i = 0; i < Widgets.Count; i++)
        {
            var instance = Widgets[i].Instance.Clone();
            instance.Order = i;
            layout.Widgets.Add(instance);
        }

        return layout;
    }

    private async Task SaveBoardAsync()
    {
        await _saveSemaphore.WaitAsync().ConfigureAwait(false);
        try
        {
            // Snapshot on the UI thread so the layout reflects consistent, current state.
            var layout = await Dispatcher.UIThread.InvokeAsync(BuildLayoutFromBoard);
            var result = await _layoutStore.SaveAsync(layout).ConfigureAwait(false);
            if (!result.IsSuccess)
                _logger.Error("Overview", $"Failed to save overview layout: {result.ErrorMessage}", result.Exception);
        }
        finally
        {
            _saveSemaphore.Release();
        }
    }

    // ----- Edit session (draft semantics) -----

    [RelayCommand]
    private void EnterEdit()
    {
        if (IsEditMode)
            return;

        _editSnapshot = BuildLayoutFromBoard();
        IsEditMode = true;
        SyncEditModeToWidgets();
    }

    [RelayCommand]
    private void Done()
    {
        if (!IsEditMode)
            return;

        CancelDrag();
        IsEditMode = false;
        SyncEditModeToWidgets();
        _editSnapshot = null;
        CloseLibrary();
        RunAndLogAsync(SaveBoardAsync(), "save overview layout");
    }

    [RelayCommand]
    private void CancelEdit()
    {
        if (!IsEditMode)
            return;

        CancelDrag();
        IsEditMode = false;
        SyncEditModeToWidgets();
        CloseLibrary();

        var snapshot = _editSnapshot;
        _editSnapshot = null;
        if (snapshot != null)
            RunAndLogAsync(PopulateBoardAsync(snapshot), "restore overview layout draft");
    }

    private void SyncEditModeToWidgets()
    {
        foreach (var host in Widgets)
            host.IsEditMode = IsEditMode;
    }

    partial void OnIsEditModeChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowEmptyState));
    }

    partial void OnIsLayoutLoadedChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowEmptyState));
    }

    // ----- Widget library -----

    [RelayCommand]
    private void OpenWidgetLibrary()
    {
        if (!IsEditMode)
            EnterEdit();

        if (_libraryOverlayId != null)
            return;

        var viewModel = new WidgetLibraryViewModel(_widgetRegistry, _localizationService, _overlayService, this);
        var view = new WidgetLibraryView { DataContext = viewModel };

        var options = new OverlayOptions
        {
            ShowBackdrop = false,
            CloseOnOutsideClick = false,
            CloseOnEscape = true,
            HorizontalAlignment = "Right",
            VerticalAlignment = "Stretch",
            Margin = "16"
        };

        _libraryViewModel = viewModel;
        _libraryOverlayId = _overlayService.CreateOverlay(view, options);
        viewModel.OverlayId = _libraryOverlayId;
        viewModel.Closed += OnLibraryClosed;
    }

    private void OnLibraryClosed(object? sender, EventArgs e)
    {
        _libraryOverlayId = null;
        if (_libraryViewModel != null)
        {
            _libraryViewModel.Closed -= OnLibraryClosed;
            _libraryViewModel.Detach();
            _libraryViewModel = null;
        }
    }

    private void CloseLibrary()
    {
        if (_libraryOverlayId != null)
            _overlayService.CloseOverlay(_libraryOverlayId);
    }

    /// <summary>Adds a new instance of the given widget type with manifest defaults (library "Add").</summary>
    public async Task AddWidgetAsync(WidgetManifest manifest)
    {
        var instance = new WidgetInstance
        {
            WidgetId = manifest.WidgetId,
            Size = manifest.DefaultSize,
            Order = Widgets.Count,
            Settings = manifest.CreateDefaultSettings()
        };

        var host = await CreateHostAsync(instance);
        host.IsEditMode = IsEditMode;
        Widgets.Add(host);
        await InitializeHostContentAsync(host);

        if (!IsEditMode)
            RunAndLogAsync(SaveBoardAsync(), "save overview layout");
    }

    // ----- IWidgetBoardHost -----

    public void RequestRemove(WidgetHostViewModel host)
    {
        host.Content?.Dispose();
        Widgets.Remove(host);

        // In edit mode removal is part of the draft (persisted by Done, undone by Cancel);
        // outside it (unavailable-widget placeholder) the removal commits immediately.
        if (!IsEditMode)
            RunAndLogAsync(SaveBoardAsync(), "save overview layout");
    }

    public void RequestResize(WidgetHostViewModel host, WidgetSize size)
    {
        if (host.Manifest == null || !host.Manifest.SupportedSizes.Contains(size))
            return;

        host.Size = size;

        if (!IsEditMode)
            RunAndLogAsync(SaveBoardAsync(), "save overview layout");
    }

    public async Task RequestConfigureAsync(WidgetHostViewModel host)
    {
        if (host.Manifest == null || host.Content is not IWidgetConfigurable configurable)
            return;

        var currentValues = await configurable.GetConfigAsync();
        var viewModel = new WidgetConfigViewModel(
            host.Manifest,
            currentValues,
            _localizationService,
            applyAsync: async values =>
            {
                await configurable.SetConfigAsync(values);
                foreach (var (key, value) in values)
                    host.Instance.Settings[key] = value;

                if (!IsEditMode)
                    RunAndLogAsync(SaveBoardAsync(), "save overview layout");
            });

        var view = new WidgetConfigView { DataContext = viewModel };
        var options = new OverlayOptions
        {
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            HorizontalAlignment = "Center",
            VerticalAlignment = "Center"
        };

        var overlayId = _overlayService.CreateOverlay(view, options);
        viewModel.AttachOverlay(_overlayService, overlayId);
    }

    // ----- Drag reordering (input translated by the view; decisions stay here + engine) -----

    public void BeginDrag(WidgetHostViewModel host)
    {
        _draggedHost = host;
        _dragOriginColumn = host.Column;
        _dragOriginRow = host.Row;
        DragAnchorIndex = Widgets.IndexOf(host);
        host.IsDragging = true;

        GhostTitle = ResolveTitle(host);
        GhostSizeLabel = host.SizeLabel;
        IsGhostVisible = true;
    }

    /// <summary>Places the dragged tile at the grid cell under the pointer; the panel resolves overlaps.</summary>
    public void UpdateDragTarget(int column, int row)
    {
        if (_draggedHost == null)
            return;

        _draggedHost.Column = column;
        _draggedHost.Row = row;
    }

    public void UpdateGhostPosition(double x, double y)
    {
        GhostX = x;
        GhostY = y;
    }

    public void CompleteDrag()
    {
        if (_draggedHost != null)
            _draggedHost.IsDragging = false;

        _draggedHost = null;
        _dragOriginColumn = -1;
        _dragOriginRow = -1;
        DragAnchorIndex = -1;
        IsGhostVisible = false;
        // Coordinates are part of the edit draft; Done persists them.
    }

    public void CancelDrag()
    {
        if (_draggedHost != null)
        {
            _draggedHost.IsDragging = false;
            _draggedHost.Column = _dragOriginColumn;
            _draggedHost.Row = _dragOriginRow;
        }

        _draggedHost = null;
        _dragOriginColumn = -1;
        _dragOriginRow = -1;
        DragAnchorIndex = -1;
        IsGhostVisible = false;
    }

    private string ResolveTitle(WidgetHostViewModel host)
    {
        if (host.Manifest == null)
            return host.Instance.WidgetId;
        return _localizationService.T(host.Manifest.DisplayNameKey, host.Manifest.TranslationNamespace);
    }

    // ----- Profile / greeting -----

    private void OnSettingChanged(object? sender, string key)
    {
        if (key == UserDisplayNameKey)
            RunAndLogAsync(LoadUserProfileAsync(), "reload user profile");
    }

    private async Task LoadUserProfileAsync()
    {
        var name = await _settingsService.GetAsync(UserDisplayNameKey, string.Empty).ConfigureAwait(false);

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            UserName = name ?? string.Empty;
            IsProfileLoaded = true;
            OnPropertyChanged(nameof(GreetingText));
        });
    }

    partial void OnUserNameChanged(string value)
    {
        if (IsProfileLoaded)
            OnPropertyChanged(nameof(GreetingText));
    }

    // ----- Plumbing -----

    /// <summary>Runs an async operation without blocking; logs any exception at the boundary.</summary>
    private async void RunAndLogAsync(Task task, string context)
    {
        try
        {
            await task.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.Error("Overview", $"Failed to {context}.", ex);
        }
    }

    private void DisposeHosts()
    {
        foreach (var host in Widgets)
            host.Content?.Dispose();
    }

    public void Dispose()
    {
        if (_isDisposed)
            return;
        _isDisposed = true;

        _settingsService.SettingChanged -= OnSettingChanged;
        _localizationService.LanguageChanged -= _languageChangedHandler;
        CloseLibrary();
        DisposeHosts();
        _saveSemaphore.Dispose();
    }
}
