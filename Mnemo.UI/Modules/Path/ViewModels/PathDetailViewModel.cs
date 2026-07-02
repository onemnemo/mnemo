using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.UI.ViewModels;
using Mnemo.UI.Modules.Path.Tasks;

namespace Mnemo.UI.Modules.Path.ViewModels;

public partial class PathDetailViewModel : ViewModelBase, INavigationAware, IDisposable
{
    private readonly ILearningPathService _pathService;
    private readonly IAITaskManager _taskManager;
    private readonly IAIOrchestrator _orchestrator;
    private readonly ILoggerService _logger;
    private readonly IStatisticsManager _statistics;

    [ObservableProperty]
    private LearningPath? _path;

    [ObservableProperty]
    private LearningUnit? _selectedUnit;

    [ObservableProperty]
    private bool _isSidebarOpen = true;

    public ObservableCollection<LearningUnit> Units { get; } = new();

    public PathDetailViewModel(
        ILearningPathService pathService,
        IAITaskManager taskManager,
        IAIOrchestrator orchestrator,
        ILoggerService logger,
        IStatisticsManager statistics)
    {
        _pathService = pathService;
        _taskManager = taskManager;
        _orchestrator = orchestrator;
        _logger = logger;
        _statistics = statistics;

        _pathService.PathUpdated += OnPathUpdated;
    }

    private void OnPathUpdated(LearningPath updatedPath)
    {
        if (Path == null || updatedPath.PathId != Path.PathId) return;

        Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
        {
            int unitsGeneratedDelta = 0;
            int unitsCompletedDelta = 0;

            // Sync properties of the path itself if needed
            Path.Title = updatedPath.Title;
            
            // Sync units
            bool changed = false;
            foreach (var updatedUnit in updatedPath.Units)
            {
                var existingUnit = Units.FirstOrDefault(u => u.UnitId == updatedUnit.UnitId);
                if (existingUnit != null)
                {
                    var hadContent = !string.IsNullOrEmpty(existingUnit.Content);
                    var nowHasContent = !string.IsNullOrEmpty(updatedUnit.Content);

                    if (existingUnit.Content != updatedUnit.Content)
                    {
                        existingUnit.Content = updatedUnit.Content;
                        changed = true;
                        if (!hadContent && nowHasContent)
                            unitsGeneratedDelta++;
                    }
                    if (existingUnit.Status != updatedUnit.Status)
                    {
                        existingUnit.Status = updatedUnit.Status;
                        changed = true;
                    }
                    if (existingUnit.IsCompleted != updatedUnit.IsCompleted)
                    {
                        if (!existingUnit.IsCompleted && updatedUnit.IsCompleted)
                            unitsCompletedDelta++;
                        existingUnit.IsCompleted = updatedUnit.IsCompleted;
                        changed = true;
                    }
                }
                else
                {
                    Units.Add(updatedUnit);
                    Path?.Units.Add(updatedUnit);
                    changed = true;
                }
            }

            if (unitsGeneratedDelta > 0)
                _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger,
                    StatisticsNamespaces.Path, PathStatKinds.DailySummary, "units_generated", unitsGeneratedDelta);
            if (unitsCompletedDelta > 0)
            {
                _ = StatisticsRecorder.IncrementDailyCounterAsync(_statistics, _logger,
                    StatisticsNamespaces.Path, PathStatKinds.DailySummary, "units_completed", unitsCompletedDelta);
                _ = StatisticsRecorder.IncrementLifetimeAsync(_statistics, _logger,
                    StatisticsNamespaces.Path, PathStatKinds.LifetimeTotals, "total_units_completed", unitsCompletedDelta);
            }
            if ((unitsGeneratedDelta > 0 || unitsCompletedDelta > 0) && Path != null)
            {
                var totalUnits = updatedPath.Units?.Count ?? 0;
                var completed = updatedPath.Units?.Count(u => u.IsCompleted) ?? 0;
                _ = StatisticsRecorder.RecordPathSummaryAsync(_statistics, _logger,
                    Path.PathId, Path.Title, totalUnits, completed);
            }

            if (changed)
            {
                Path?.RefreshProgress();
            }

            // Remove units that no longer exist
            IEnumerable<LearningUnit> remoteUnits = updatedPath.Units ?? Enumerable.Empty<LearningUnit>();
            var toRemove = Units.Where(u => !remoteUnits.Any(uu => uu.UnitId == u.UnitId)).ToList();
            foreach (var u in toRemove)
            {
                Units.Remove(u);
                Path?.Units.Remove(u);
                changed = true;
            }

            if (changed)
            {
                Path?.RefreshProgress();
            }
        });
    }

    public void OnNavigatedTo(object? parameter)
    {
        if (parameter is string pathId)
        {
            _ = LoadPathAsync(pathId);
        }
    }

    public void Dispose()
    {
        _pathService.PathUpdated -= OnPathUpdated;
    }

    public async Task LoadPathAsync(string pathId)
    {
        var path = await _pathService.GetPathAsync(pathId);
        
        await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
        {
            Path = path;
            if (Path != null)
            {
                SelectedUnit = null;
                Units.Clear();
                foreach (var unit in Path.Units.OrderBy(u => u.Order))
                {
                    Units.Add(unit);
                }
                SelectedUnit = Units.FirstOrDefault();
            }
        });
    }

    [RelayCommand]
    private void ToggleSidebar() => IsSidebarOpen = !IsSidebarOpen;

    [RelayCommand]
    private async Task GenerateUnit(LearningUnit unit)
    {
        await GenerateUnitAsync(unit);
    }

    private async Task GenerateUnitAsync(LearningUnit unit)
    {
        if (Path == null) return;

        unit.IsCompleted = false;
        unit.Status = AITaskStatus.Running;

        var task = new GenerateUnitTask(
            Path.PathId,
            unit.UnitId,
            _orchestrator,
            _pathService,
            _logger);

        _logger.Info("Path", $"Triggering generation for unit: {unit.Title}");
        await _taskManager.QueueTaskAsync(task);
    }
}

