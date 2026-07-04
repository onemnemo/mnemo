using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Modules.Mindmap.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

public partial class MindmapOverviewViewModel : ViewModelBase
{
    private readonly IMindmapService _mindmapService;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILoggerService _logger;
    private readonly IDateDisplayService _dateDisplay;

    [ObservableProperty]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private bool _isGridView;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _showEmptyState;

    [ObservableProperty]
    private bool _showNoResultsState;

    public ObservableCollection<MindmapItemViewModel> FrequentlyUsedItems { get; } = new();
    public ObservableCollection<MindmapItemViewModel> AllItems { get; } = new();
    public ObservableCollection<MindmapItemViewModel> FilteredItems { get; } = new();

    public ICommand ToggleViewCommand { get; }
    public ICommand CreateCommand { get; }
    public ICommand OpenMindmapCommand { get; }
    public ICommand DeleteMindmapCommand { get; }

    public MindmapOverviewViewModel(
        IMindmapService mindmapService,
        INavigationService navigation,
        IOverlayService overlay,
        ILoggerService logger,
        IDateDisplayService dateDisplay)
    {
        _mindmapService = mindmapService;
        _navigation = navigation;
        _overlay = overlay;
        _logger = logger;
        _dateDisplay = dateDisplay;

        ToggleViewCommand = new RelayCommand(() => IsGridView = !IsGridView);
        CreateCommand = new RelayCommand(CreateNewMindmap);
        OpenMindmapCommand = new RelayCommand<MindmapItemViewModel>(OpenMindmap);
        DeleteMindmapCommand = new AsyncRelayCommand<MindmapItemViewModel>(DeleteMindmapAsync);

        AllItems.CollectionChanged += (_, _) => ApplySearchFilter();
        _ = LoadMindmapsAsync();
    }

    partial void OnSearchTextChanged(string value) => ApplySearchFilter();

    private void ApplySearchFilter()
    {
        var query = SearchText?.Trim() ?? string.Empty;
        FilteredItems.Clear();
        var source = string.IsNullOrEmpty(query)
            ? AllItems
            : AllItems.Where(i => i.Name.Contains(query, StringComparison.OrdinalIgnoreCase));
        foreach (var item in source)
            FilteredItems.Add(item);

        ShowEmptyState = AllItems.Count == 0;
        ShowNoResultsState = AllItems.Count > 0 && FilteredItems.Count == 0;
    }

    private async Task LoadMindmapsAsync()
    {
        if (IsLoading) return;
        IsLoading = true;

        try
        {
            var result = await _mindmapService.GetAllMindmapsAsync();
            if (result.IsSuccess && result.Value != null)
            {
                var viewModels = result.Value.Select(m =>
                {
                    var vm = new MindmapItemViewModel
                    {
                        Id = m.Id,
                        Name = m.Title,
                        NodeCount = m.Nodes.Count,
                        EdgeCount = m.Edges.Count,
                        LastModified = m.ModifiedAt is DateTime dt ? _dateDisplay.FormatSmart(dt) : "—"
                    };
                    MindmapPreviewBuilder.PopulatePreviews(vm, m);
                    return vm;
                }).ToList();

                await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
                {
                    AllItems.Clear();
                    FrequentlyUsedItems.Clear();

                    foreach (var vm in viewModels)
                        AllItems.Add(vm);

                    foreach (var m in AllItems.Take(4))
                        FrequentlyUsedItems.Add(m);

                    ApplySearchFilter();
                });
            }
        }
        finally
        {
            IsLoading = false;
        }
    }

    public Task RefreshAsync() => LoadMindmapsAsync();

    private void OpenMindmap(MindmapItemViewModel? item)
    {
        if (item != null)
            _navigation.NavigateTo("mindmap-detail", item.Id);
    }

    private async Task DeleteMindmapAsync(MindmapItemViewModel? item)
    {
        if (item == null) return;

        var result = await _overlay.CreateDialogAsync(
            "Delete Mindmap",
            $"Are you sure you want to delete '{item.Name}'?",
            "Delete",
            "Cancel",
            severity: DialogSeverity.Destructive);

        if (result == "Delete")
        {
            var deleteResult = await _mindmapService.DeleteMindmapAsync(item.Id);
            if (deleteResult.IsSuccess)
            {
                await LoadMindmapsAsync();
                _logger.Info("Mindmap", $"Deleted mindmap: {item.Name}");
            }
            else
            {
                await _overlay.CreateDialogAsync("Error", $"Failed to delete: {deleteResult.ErrorMessage}");
            }
        }
    }

    private void CreateNewMindmap()
    {
        var inputOverlay = new InputDialogOverlay
        {
            Title = "Create New Mindmap",
            Placeholder = "Enter mindmap name...",
            InputValue = "New Mindmap",
            ConfirmText = "Create",
            CancelText = "Cancel"
        };

        var options = new OverlayOptions
        {
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        };

        var id = _overlay.CreateOverlay(inputOverlay, options);

        inputOverlay.OnResult = async (result) =>
        {
            _overlay.CloseOverlay(id);

            if (string.IsNullOrWhiteSpace(result)) return;

            try
            {
                var createResult = await _mindmapService.CreateMindmapAsync(result);
                if (createResult.IsSuccess && createResult.Value != null)
                    _navigation.NavigateTo("mindmap-detail", createResult.Value.Id);
                else
                    await _overlay.CreateDialogAsync("Error", $"Failed to create: {createResult.ErrorMessage}");
            }
            catch (Exception ex)
            {
                _logger.Error("Mindmap", "Failed to create mindmap", ex);
            }
        };
    }
}
