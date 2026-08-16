using System.Collections.Concurrent;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.I18n;

/// <summary>
/// Serves the SPA its i18n data: the available languages and the fully merged
/// per-culture translation bundle. Sources merge in registration order, later
/// overriding earlier, as in <c>LocalizationService.LoadAndMergeAsync</c>.
/// Bundles are immutable per culture, so they are computed once and cached.
/// </summary>
/// <remarks>
/// One deliberate difference from the desktop app: a culture's bundle starts
/// from English rather than from nothing. A key nobody has translated yet
/// otherwise reaches the SPA as no entry at all, and its translate helper
/// answers a missing key with the key - so a new string shipped ahead of its
/// translations reads as <c>SaveStateSaved</c> on a Norwegian screen. English
/// text is a worse answer than Norwegian text and a far better one than an
/// identifier, and getting it here means every future key is covered without
/// anyone having to remember.
/// </remarks>
public sealed class TranslationBundleService
{
    private const string FallbackCulture = "en";

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
        => _cache.GetOrAdd(culture, c => BuildAsync(c, cancellationToken));

    private async Task<IReadOnlyDictionary<string, Dictionary<string, string>>> BuildAsync(
        string culture, CancellationToken cancellationToken)
    {
        var merged = IsFallback(culture)
            ? new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
            // Through the cache, so English is merged once however many cultures
            // are asked for. Recursion stops at the branch above.
            : Copy(await GetBundleAsync(FallbackCulture, cancellationToken).ConfigureAwait(false));

        await MergeIntoAsync(merged, culture, cancellationToken).ConfigureAwait(false);
        return merged;
    }

    /// <summary>
    /// True for English itself, region included: <c>en-GB</c> has no English to
    /// fall back to that is not already what it is asking for.
    /// </summary>
    private static bool IsFallback(string culture)
    {
        var separator = culture.IndexOf('-');
        var language = separator < 0 ? culture : culture[..separator];
        return string.Equals(language, FallbackCulture, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Detaches the inner dictionaries so overlaying cannot write into the cached bundle.</summary>
    private static Dictionary<string, Dictionary<string, string>> Copy(
        IReadOnlyDictionary<string, Dictionary<string, string>> bundle)
    {
        var copy = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (ns, entries) in bundle)
            copy[ns] = new Dictionary<string, string>(entries, StringComparer.OrdinalIgnoreCase);
        return copy;
    }

    private async Task MergeIntoAsync(
        Dictionary<string, Dictionary<string, string>> merged, string culture, CancellationToken cancellationToken)
    {
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
    }
}
