using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.UI.Services;

/// <summary>
/// Defers module tool registration and skill disk loading until <see cref="NavigationService.AiAssistantEnabledKey"/> is true.
/// Unloads both when the setting is turned off.
/// </summary>
public sealed class AiAssistantToolHost : IAiAssistantToolHost
{
    private readonly IReadOnlyList<IModule> _modules;
    private readonly IServiceProvider _services;
    private readonly IFunctionRegistry _functionRegistry;
    private readonly ISkillRegistry _skillRegistry;
    private readonly ISettingsService _settingsService;
    private readonly ILoggerService _logger;
    private readonly IPerfDiagnostics _perf;
    private readonly object _loadLock = new();
    private volatile bool _loaded;

    public AiAssistantToolHost(
        IReadOnlyList<IModule> modules,
        IServiceProvider services,
        IFunctionRegistry functionRegistry,
        ISkillRegistry skillRegistry,
        ISettingsService settingsService,
        ILoggerService logger,
        IPerfDiagnostics perf)
    {
        _modules = modules;
        _services = services;
        _functionRegistry = functionRegistry;
        _skillRegistry = skillRegistry;
        _settingsService = settingsService;
        _logger = logger;
        _perf = perf;
        _settingsService.SettingChanged += OnSettingChanged;
        _ = InitializeFromSettingsAsync();
    }

    public bool IsLoaded => _loaded;

    public async Task EnsureLoadedAsync(CancellationToken cancellationToken = default)
    {
        if (_loaded)
            return;

        using var scope = _perf.Measure("Startup", "AiAssistantToolHost.EnsureLoaded");

        lock (_loadLock)
        {
            if (_loaded)
                return;

            foreach (var module in _modules)
            {
                var moduleName = module.GetType().Name;
                using (_perf.Measure("Startup", $"{moduleName}.RegisterTools"))
                    module.RegisterTools(_functionRegistry, _services);
                _logger.Debug("AiAssistantToolHost", $"{moduleName}.RegisterTools (AI assistant enabled).");
            }

            _loaded = true;
        }

        try
        {
            using (_perf.Measure("Startup", "SkillRegistry.LoadAsync"))
                await _skillRegistry.LoadAsync(cancellationToken).ConfigureAwait(false);
            ToolManifestValidator.ValidateAndLog(_skillRegistry, _functionRegistry, _logger);
            _perf.RecordMetric("Startup", "AiAssistant.tools", _functionRegistry.GetTools().Count(), "tools");
        }
        catch (Exception ex)
        {
            lock (_loadLock)
            {
                _functionRegistry.ClearTools();
                _loaded = false;
            }
            _logger.Error("AiAssistantToolHost", "Failed to load skills after registering tools.", ex);
            throw;
        }
    }

    public void Unload()
    {
        lock (_loadLock)
        {
            if (!_loaded)
                return;

            _functionRegistry.ClearTools();
            _skillRegistry.Unload();
            _loaded = false;
            _logger.Debug("AiAssistantToolHost", "AI tools and skills unloaded (AI assistant disabled).");
        }
    }

    private async Task InitializeFromSettingsAsync()
    {
        try
        {
            var enabled = await _settingsService
                .GetAsync(NavigationService.AiAssistantEnabledKey, false)
                .ConfigureAwait(false);
            if (enabled)
                await EnsureLoadedAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.Error("AiAssistantToolHost", "Initial AI tool/skill load failed.", ex);
        }
    }

    private async void OnSettingChanged(object? sender, string key)
    {
        if (!string.Equals(key, NavigationService.AiAssistantEnabledKey, StringComparison.Ordinal))
            return;

        try
        {
            var enabled = await _settingsService
                .GetAsync(NavigationService.AiAssistantEnabledKey, false)
                .ConfigureAwait(false);
            if (enabled)
                await EnsureLoadedAsync().ConfigureAwait(false);
            else
                Unload();
        }
        catch (Exception ex)
        {
            _logger.Error("AiAssistantToolHost", "Failed to apply AI.EnableAssistant change.", ex);
        }
    }
}
