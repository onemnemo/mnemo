using System;
using System.Threading.Tasks;
using Atlas.Orchestration;
using Atlas.Tools.WebSearch;
using Microsoft.Extensions.Options;
using Mnemo.Core.Services;

namespace Mnemo.UI.Mcp;

/// <summary>
/// Bridges Mnemo's <see cref="ISettingsService"/> (SQLite-backed user settings) into
/// Atlas's live option instances (<see cref="ChatOptions"/>, <see cref="WebSearchOptions"/>)
/// so that changes made in the Settings UI take effect immediately on the next request
/// without restarting the application.
/// </summary>
public sealed class AtlasOptionsBridge : IDisposable
{
    private readonly ISettingsService _settings;
    private readonly ChatOptions _chatOptions;
    private readonly WebSearchOptions _webSearchOptions;
    private readonly ILoggerService _logger;

    public AtlasOptionsBridge(
        ISettingsService settings,
        IOptions<ChatOptions> chatOptions,
        IOptions<WebSearchOptions> webSearchOptions,
        ILoggerService logger)
    {
        _settings = settings;
        _chatOptions = chatOptions.Value;
        _webSearchOptions = webSearchOptions.Value;
        _logger = logger;

        _settings.SettingChanged += OnSettingChanged;
        _ = ApplyAllAsync();
    }

    private async void OnSettingChanged(object? sender, string key)
    {
        try
        {
            await ApplyKeyAsync(key).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.Warning("AtlasOptionsBridge", $"Failed to apply setting '{key}': {ex.Message}");
        }
    }

    private async Task ApplyAllAsync()
    {
        try
        {
            var webSearchEnabled = await _settings.GetAsync("AI.WebSearch.Enabled", false).ConfigureAwait(false);
            var provider = await _settings.GetAsync("AI.WebSearch.Provider", "None").ConfigureAwait(false);
            var searxngUrl = await _settings.GetAsync("AI.WebSearch.SearxngUrl", "").ConfigureAwait(false);
            var braveKey = await _settings.GetAsync("AI.WebSearch.BraveApiKey", "").ConfigureAwait(false);

            ApplyWebSearch(webSearchEnabled, provider, searxngUrl, braveKey);
        }
        catch (Exception ex)
        {
            _logger.Warning("AtlasOptionsBridge", $"Initial settings apply failed: {ex.Message}");
        }
    }

    private async Task ApplyKeyAsync(string key)
    {
        switch (key)
        {
            case "AI.WebSearch.Enabled":
            case "AI.WebSearch.Provider":
            case "AI.WebSearch.SearxngUrl":
            case "AI.WebSearch.BraveApiKey":
                await ApplyAllAsync().ConfigureAwait(false);
                break;
        }
    }

    private void ApplyWebSearch(bool enabled, string provider, string searxngUrl, string braveKey)
    {
        if (!enabled)
        {
            _webSearchOptions.Provider = WebSearchProvider.None;
            return;
        }

        _webSearchOptions.Provider = provider switch
        {
            "DuckDuckGo" => WebSearchProvider.DuckDuckGo,
            "SearXNG" or "Searxng" => WebSearchProvider.Searxng,
            "Brave" => WebSearchProvider.Brave,
            _ => WebSearchProvider.None
        };

        if (!string.IsNullOrWhiteSpace(searxngUrl))
            _webSearchOptions.BaseUrl = searxngUrl;

        if (!string.IsNullOrWhiteSpace(braveKey))
            _webSearchOptions.ApiKey = braveKey;
    }

    public void Dispose()
    {
        _settings.SettingChanged -= OnSettingChanged;
    }
}
