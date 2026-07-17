using System.Collections.Concurrent;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.I18n;

/// <summary>
/// Serves the SPA its i18n data: the available languages and the fully merged
/// per-culture translation bundle. The merge mirrors
/// <c>LocalizationService.LoadAndMergeAsync</c> (sources in registration order,
/// later overriding earlier) so the SPA sees exactly what the desktop app would.
/// Bundles are immutable per culture, so they are computed once and cached.
/// </summary>
public sealed class TranslationBundleService
{
    private readonly IReadOnlyList<ITranslationSource> _sources;
    private readonly ILocalizationService _localization;
    private readonly ILoggerService _logger;
    private readonly ConcurrentDictionary<string, Task<IReadOnlyDictionary<string, Dictionary<string, string>>>> _cache =
        new(StringComparer.OrdinalIgnoreCase);

    public TranslationBundleService(
        IReadOnlyList<ITranslationSource> sources, ILocalizationService localization, ILoggerService logger)
    {
        _sources = sources;
        _localization = localization;
        _logger = logger;
    }

    public async Task<IReadOnlyList<LanguageDto>> GetLanguagesAsync()
    {
        var manifests = await _localization.GetAvailableLanguagesAsync().ConfigureAwait(false);
        return manifests.Select(LanguageDto.FromManifest).ToList();
    }

    /// <summary>Merged <c>namespace -&gt; (key -&gt; value)</c> bundle for a culture (cached).</summary>
    public Task<IReadOnlyDictionary<string, Dictionary<string, string>>> GetBundleAsync(
        string culture, CancellationToken cancellationToken = default)
        => _cache.GetOrAdd(culture, c => MergeAsync(c, cancellationToken));

    private async Task<IReadOnlyDictionary<string, Dictionary<string, string>>> MergeAsync(
        string culture, CancellationToken cancellationToken)
    {
        var merged = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in _sources)
        {
            cancellationToken.ThrowIfCancellationRequested();
            IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>? data;
            try
            {
                data = await source.GetTranslationsForCultureAsync(culture, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.Error("Mnemo.Host", $"Translation source failed for culture '{culture}'.", ex);
                continue;
            }

            if (data is null)
                continue;

            foreach (var (ns, entries) in data)
            {
                if (string.IsNullOrEmpty(ns) || entries is null)
                    continue;
                if (!merged.TryGetValue(ns, out var keys))
                {
                    keys = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    merged[ns] = keys;
                }

                foreach (var (key, value) in entries)
                {
                    if (!string.IsNullOrEmpty(key))
                        keys[key] = value ?? key;
                }
            }
        }

        return merged;
    }
}
