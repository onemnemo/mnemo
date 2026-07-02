using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Input;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.UI.ViewModels;
using Mnemo.UI.Modules.Path.ViewModels;
using Mnemo.UI.Modules.Path.Tasks;
using Mnemo.UI.Components;

namespace Mnemo.UI.Modules.Path.ViewModels;

public class PathViewModel : ViewModelBase, IDisposable
{
    private readonly IAITaskManager _taskManager;
    private readonly IAIOrchestrator _orchestrator;
    private readonly ILearningPathService _pathService;
    private readonly INavigationService _navigation;
    private readonly IOverlayService _overlay;
    private readonly ILoggerService _logger;
    private readonly IStatisticsManager _statistics;

    private string _searchText = string.Empty;
    public string SearchText
    {
        get => _searchText;
        set => SetProperty(ref _searchText, value);
    }

    private bool _isGridView = false;
    public bool IsGridView
    {
        get => _isGridView;
        set => SetProperty(ref _isGridView, value);
    }

    public ObservableCollection<PathItemViewModel> FrequentlyUsedItems { get; } = new();
    public ObservableCollection<PathBaseViewModel> AllItems { get; } = new();

    public ICommand ToggleViewCommand { get; }
    public ICommand CreateCommand { get; }
    public ICommand OpenPathCommand { get; }
    public ICommand DeletePathCommand { get; }

    public PathViewModel(
        IAITaskManager taskManager, 
        IAIOrchestrator orchestrator,
        ILearningPathService pathService,
        INavigationService navigation,
        IOverlayService overlay,
        ILoggerService logger,
        IStatisticsManager statistics)
    {
        _taskManager = taskManager;
        _orchestrator = orchestrator;
        _pathService = pathService;
        _navigation = navigation;
        _overlay = overlay;
        _logger = logger;
        _statistics = statistics;

        _pathService.PathUpdated += OnPathUpdated;

        ToggleViewCommand = new RelayCommand(() => IsGridView = !IsGridView);
        CreateCommand = new RelayCommand(CreateNewItem);
        OpenPathCommand = new RelayCommand<PathBaseViewModel>(OpenPath);
        DeletePathCommand = new RelayCommand<PathBaseViewModel>(DeletePath);

        _ = LoadPathsAsync();
    }

    private async Task LoadPathsAsync()
    {
        var paths = await _pathService.GetAllPathsAsync();
        var pathList = paths.ToList();
        
        await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
        {
            FrequentlyUsedItems.Clear();
            AllItems.Clear();

            foreach (var path in pathList)
            {
                var vm = new PathItemViewModel 
                { 
                    Id = path.PathId,
                    Name = path.Title, 
                    LastModified = path.Metadata.CreatedAt.ToString("MM/dd/yyyy"), 
                    Size = 0,
                    Progress = path.Progress, 
                    Category = string.Empty 
                };
                AllItems.Add(vm);
            }

            foreach (var path in pathList.Take(4))
            {
                var vm = new PathItemViewModel 
                { 
                    Id = path.PathId,
                    Name = path.Title, 
                    LastModified = path.Metadata.CreatedAt.ToString("MM/dd/yyyy"), 
                    Size = 0,
                    Progress = path.Progress, 
                    Category = string.Empty 
                };
                FrequentlyUsedItems.Add(vm);
            }

        });
    }

    private void OnPathUpdated(LearningPath path)
    {
        _ = LoadPathsAsync();
    }

    public void Dispose()
    {
        _pathService.PathUpdated -= OnPathUpdated;
    }

    private void OpenPath(PathBaseViewModel? item)
    {
        if (item is PathItemViewModel pathItem && !string.IsNullOrEmpty(pathItem.Id))
        {
            _navigation.NavigateTo("path-detail", pathItem.Id);
        }
    }

    private async void DeletePath(PathBaseViewModel? item)
    {
        if (item is PathItemViewModel pathItem && !string.IsNullOrEmpty(pathItem.Id))
        {
            var result = await _overlay.CreateDialogAsync(
                "Delete Path", 
                $"Are you sure you want to delete '{pathItem.Name}'? This action cannot be undone.",
                "Delete",
                "Cancel");
            
            if (result == "Delete")
            {
                var deleteResult = await _pathService.DeletePathAsync(pathItem.Id);
                if (deleteResult.IsSuccess)
                {
                    _ = LoadPathsAsync();
                    _logger.Info("Path", $"Deleted path: {pathItem.Name}");
                }
                else
                {
                    await _overlay.CreateDialogAsync("Error", $"Failed to delete path: {deleteResult.ErrorMessage}");
                    _logger.Error("Path", $"Failed to delete path: {deleteResult.ErrorMessage}");
                }
            }
        }
    }

    private void CreateNewItem()
    {
        var inputBuilder = new InputBuilder();
        var options = new OverlayOptions
        {
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        };
        
        var id = _overlay.CreateOverlay(inputBuilder, options, "Create Learning Path");
        
        inputBuilder.GenerateRequested += async (s, e) =>
        {
            try 
            {
                _overlay.CloseOverlay(id);
                await StartGeneration(e.text, e.files);
            }
            catch (Exception ex)
            {
                _logger.Error("Path", "Failed to start generation", ex);
                await _overlay.CreateDialogAsync("Error", $"Could not start generation: {ex.Message}");
            }
        };
    }

    private async Task StartGeneration(string topic, string[] files)
    {
        var task = new GeneratePathTask(
            topic, 
            "", 
            files, 
            _orchestrator, 
            _pathService, 
            _logger);

        await _taskManager.QueueTaskAsync(task);
        
        _logger.Info("Path", $"Started generation for: {topic}");
        
        // Wait for the path to be created in the first step
        while (task.GeneratedPath == null && 
               (task.Status == AITaskStatus.Running || task.Status == AITaskStatus.Pending))
        {
            await Task.Delay(500);
        }

        if (task.Status == AITaskStatus.Failed)
        {
            _logger.Error("Path", $"Generation failed: {task.Steps.FirstOrDefault(s => s.Status == AITaskStatus.Failed)?.ErrorMessage}");
            await _overlay.CreateDialogAsync("Generation Failed", "Could not create the learning path. Please check your connection or try again.");
            return;
        }

        if (task.GeneratedPath != null)
        {
            _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger,
                StatisticsNamespaces.Path, PathStatKinds.DailySummary, "paths_created");
            _ = StatisticsRecorder.IncrementLifetimeAsync(_statistics, _logger,
                StatisticsNamespaces.Path, PathStatKinds.LifetimeTotals, "total_paths_created");
            _ = StatisticsRecorder.RecordPathSummaryAsync(_statistics, _logger,
                task.GeneratedPath.PathId,
                task.GeneratedPath.Title,
                task.GeneratedPath.Units?.Count ?? 0,
                0);

            _navigation.NavigateTo("path-detail", task.GeneratedPath.PathId);
            _ = LoadPathsAsync();
        }
    }

}
