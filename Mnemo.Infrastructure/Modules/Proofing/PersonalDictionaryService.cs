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
    private PersonalWordLookup? _lookup;

    public PersonalDictionaryService(ISettingsService settings)
    {
        _settings = settings;
    }

    /// <summary>
    /// The whole list is rewritten on every addition and read back into a lookup on every check, so
    /// this bounds both. A person adding a word at a time is nowhere near it, and a list this long
    /// wants a dictionary of its own rather than a settings value.
    /// </summary>
    public int MaxWords => 5_000;

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

    public async Task<PersonalWordAddResult> AddAsync(string word, string? language, CancellationToken ct)
    {
        var trimmed = (word ?? string.Empty).Trim();
        if (!ProofingTokenizer.IsCheckableWord(trimmed))
            return PersonalWordAddResult.NotCheckable;

        var scope = NormalizeLanguage(language);

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var words = await LoadAsync().ConfigureAwait(false);
            if (words.Any(w => Matches(w, trimmed, scope)))
                return PersonalWordAddResult.AlreadyPresent;

            if (words.Count >= MaxWords)
                return PersonalWordAddResult.LimitReached;

            words.Add(new PersonalWord(trimmed, scope, DateTimeOffset.UtcNow));
            await PersistAsync(words).ConfigureAwait(false);
            return PersonalWordAddResult.Added;
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

    public async Task<PersonalWordLookup> LookupAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var words = await LoadAsync().ConfigureAwait(false);
            return _lookup ??= new PersonalWordLookup(words);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Whether two entries are the same one. The word compares in composed form, so a word typed
    /// with a precomposed accent and the same word typed with a combining one are not stored twice
    /// and cannot be left behind by a removal aimed at the other spelling.
    /// </summary>
    private static bool Matches(PersonalWord stored, string word, string? language) =>
        string.Equals(
            PersonalWordLookup.Normalize(stored.Word),
            PersonalWordLookup.Normalize(word),
            StringComparison.OrdinalIgnoreCase)
        && string.Equals(stored.Language, language, StringComparison.OrdinalIgnoreCase);

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
                if (seeded.Count >= MaxWords)
                    return seeded;
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
        _lookup = null;
        return _settings.SetAsync(StorageKey, words);
    }
}
