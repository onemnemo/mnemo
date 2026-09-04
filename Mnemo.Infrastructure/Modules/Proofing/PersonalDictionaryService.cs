using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// The user's own words, stored as one settings value.
/// <para>
/// Every read and write goes through a single gate. A setting is written by full replacement and the
/// store does no locking of its own, so two unguarded add requests would each read the same list and
/// the second write would drop the first word. The gate makes the read, the edit and the write one
/// step.
/// </para>
/// <para>
/// The value is deliberately not in the settings key allowlist. It is neither a boolean nor a string,
/// so the generic settings endpoint could not serve it, and the proofing endpoints are the only way
/// in.
/// </para>
/// </summary>
public sealed class PersonalDictionaryService : IPersonalDictionaryService
{
    /// <summary>Where the words are stored.</summary>
    public const string StorageKey = "Proofing.PersonalWords";

    /// <summary>The older per-language list this service seeds itself from once.</summary>
    public const string LegacyStorageKey = "Editor.SpellCheckCustomWordsByLanguage";

    private readonly ISettingsService _settings;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private List<PersonalWord>? _cache;

    public PersonalDictionaryService(ISettingsService settings)
    {
        _settings = settings;
    }

    public async Task<IReadOnlyList<PersonalWord>> ListAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var words = await LoadAsync().ConfigureAwait(false);
            return [.. words.OrderByDescending(w => w.AddedAt)];
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task AddAsync(string word, string? language, CancellationToken ct)
    {
        var trimmed = (word ?? string.Empty).Trim();
        if (trimmed.Length == 0)
            return;

        var scope = NormalizeLanguage(language);

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var words = await LoadAsync().ConfigureAwait(false);
            if (words.Any(w => Matches(w, trimmed, scope)))
                return;

            words.Add(new PersonalWord(trimmed, scope, DateTimeOffset.UtcNow));
            await PersistAsync(words).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RemoveAsync(string word, string? language, CancellationToken ct)
    {
        var trimmed = (word ?? string.Empty).Trim();
        if (trimmed.Length == 0)
            return;

        var scope = NormalizeLanguage(language);

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var words = await LoadAsync().ConfigureAwait(false);
            if (words.RemoveAll(w => Matches(w, trimmed, scope)) > 0)
                await PersistAsync(words).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> ContainsAsync(string word, string language, CancellationToken ct)
    {
        var trimmed = (word ?? string.Empty).Trim();
        if (trimmed.Length == 0)
            return false;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var words = await LoadAsync().ConfigureAwait(false);
            return words.Any(w =>
                string.Equals(w.Word, trimmed, StringComparison.OrdinalIgnoreCase)
                && (w.Language is null || SameLanguage(w.Language, language)));
        }
        finally
        {
            _gate.Release();
        }
    }

    private static bool Matches(PersonalWord stored, string word, string? language) =>
        string.Equals(stored.Word, word, StringComparison.OrdinalIgnoreCase)
        && string.Equals(stored.Language, language, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Compares scopes by their primary subtag, so a word scoped to <c>en</c> is accepted while
    /// checking <c>en-US</c>. Words seeded from the older editor setting carry bare codes, and a word
    /// the user vouched for in English is not a mistake in American English.
    /// </summary>
    private static bool SameLanguage(string scope, string language) =>
        string.Equals(PrimarySubtag(scope), PrimarySubtag(language), StringComparison.OrdinalIgnoreCase);

    private static string PrimarySubtag(string tag)
    {
        var cut = tag.IndexOfAny(['-', '_']);
        return cut < 0 ? tag : tag[..cut];
    }

    private static string? NormalizeLanguage(string? language) =>
        string.IsNullOrWhiteSpace(language) ? null : language.Trim();

    /// <summary>Caller must hold the gate.</summary>
    private async Task<List<PersonalWord>> LoadAsync()
    {
        if (_cache is not null)
            return _cache;

        // PersonalWord is the stored shape as well as the returned one. A field added to it later has
        // to tolerate being absent from rows written by today's build.
        var stored = await _settings.GetAsync<List<PersonalWord>?>(StorageKey, null).ConfigureAwait(false);
        if (stored is not null)
        {
            _cache = [.. stored.Where(w => !string.IsNullOrWhiteSpace(w.Word))];
            return _cache;
        }

        _cache = await SeedFromLegacyAsync().ConfigureAwait(false);
        if (_cache.Count > 0)
            await PersistAsync(_cache).ConfigureAwait(false);

        return _cache;
    }

    /// <summary>
    /// Reads the older editor setting the first time this store is used, so words added before this
    /// feature existed are still accepted. The old key is left in place: it is the only copy of that
    /// data, and nothing else has ever written it.
    /// </summary>
    private async Task<List<PersonalWord>> SeedFromLegacyAsync()
    {
        var legacy = await _settings
            .GetAsync<Dictionary<string, string[]>?>(LegacyStorageKey, null)
            .ConfigureAwait(false);
        if (legacy is null || legacy.Count == 0)
            return [];

        // The old shape keyed words by a bare language code and had no timestamps, so seeded entries
        // all carry the moment of the migration and keep their original language scope.
        var now = DateTimeOffset.UtcNow;
        var seeded = new List<PersonalWord>();
        foreach (var (code, words) in legacy)
        {
            var scope = NormalizeLanguage(code);
            foreach (var word in words ?? [])
            {
                var trimmed = (word ?? string.Empty).Trim();
                if (trimmed.Length == 0)
                    continue;
                if (seeded.Any(w => Matches(w, trimmed, scope)))
                    continue;
                seeded.Add(new PersonalWord(trimmed, scope, now));
            }
        }

        return seeded;
    }

    /// <summary>Caller must hold the gate.</summary>
    private Task PersistAsync(List<PersonalWord> words)
    {
        _cache = words;
        return _settings.SetAsync(StorageKey, words);
    }
}
