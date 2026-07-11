using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Settings.ViewModels;

/// <summary>
/// A settings row that picks a provider model for one role. Options load asynchronously from
/// the model catalog; the saved choice is seeded first so the row never flashes empty, and a
/// saved id missing from the curated list is kept as its own option rather than discarded.
/// </summary>
public partial class ModelPickerSettingViewModel : ViewModelBase, ISettingsSearchable
{
    private readonly ISettingsService _settingsService;
    private readonly IModelCatalogService _catalog;
    private readonly IMainThreadDispatcher _dispatcher;
    private readonly ILoggerService _logger;
    private readonly string _settingsKey;
    private readonly string _defaultModelId;

    /// <summary>Set while options are replaced programmatically so re-selection does not persist.</summary>
    private bool _suppressPersist;

    [ObservableProperty] private string _title;
    [ObservableProperty] private string _description;
    [ObservableProperty] private ModelOptionViewModel? _selectedOption;
    [ObservableProperty] private bool _isLoading = true;

    public ObservableCollection<ModelOptionViewModel> Options { get; } = new();

    public ModelPickerSettingViewModel(
        ISettingsService settingsService,
        IModelCatalogService catalog,
        IMainThreadDispatcher dispatcher,
        ILoggerService logger,
        string settingsKey,
        string title,
        string description,
        string defaultModelId)
    {
        _settingsService = settingsService;
        _catalog = catalog;
        _dispatcher = dispatcher;
        _logger = logger;
        _settingsKey = settingsKey;
        _defaultModelId = defaultModelId;
        _title = title;
        _description = description;

        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            var savedId = await _settingsService.GetAsync(_settingsKey, _defaultModelId).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(savedId))
            {
                savedId = _defaultModelId;
            }

            // Seed with the saved choice immediately; the catalog may need a network round-trip.
            await ApplyOptionsAsync(new[] { new ModelOptionViewModel(savedId, savedId) }, savedId).ConfigureAwait(false);

            var curated = await _catalog.GetCuratedModelsAsync().ConfigureAwait(false);
            var options = curated
                .Select(m => new ModelOptionViewModel(m.Id, m.DisplayName))
                .ToList();
            if (options.All(o => !string.Equals(o.Id, savedId, StringComparison.Ordinal)))
            {
                options.Insert(0, new ModelOptionViewModel(savedId, savedId));
            }

            await ApplyOptionsAsync(options, savedId).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // The row must still work offline or on a settings hiccup: fall back to the default id.
            _logger.Warning("ModelPickerSetting", $"Model options for {_settingsKey} fell back to the default: {ex.Message}");
            await ApplyOptionsAsync(new[] { new ModelOptionViewModel(_defaultModelId, _defaultModelId) }, _defaultModelId).ConfigureAwait(false);
        }
    }

    private Task ApplyOptionsAsync(IReadOnlyList<ModelOptionViewModel> options, string fallbackId)
    {
        return _dispatcher.InvokeAsync(() =>
        {
            var currentId = SelectedOption?.Id ?? fallbackId;
            _suppressPersist = true;
            try
            {
                Options.Clear();
                foreach (var option in options)
                {
                    Options.Add(option);
                }
                SelectedOption = Options.FirstOrDefault(o => string.Equals(o.Id, currentId, StringComparison.Ordinal))
                    ?? Options.FirstOrDefault();
            }
            finally
            {
                _suppressPersist = false;
            }

            IsLoading = false;
            return Task.CompletedTask;
        });
    }

    partial void OnSelectedOptionChanged(ModelOptionViewModel? value)
    {
        if (_suppressPersist || value is null)
        {
            return;
        }

        _ = _settingsService.SetAsync(_settingsKey, value.Id);
    }
}
