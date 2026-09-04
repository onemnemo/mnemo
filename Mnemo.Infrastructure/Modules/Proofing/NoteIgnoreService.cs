using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// Per-note ignore lists, stored as one settings value keyed by note id.
/// <para>
/// Gated for the same reason the personal dictionary is: a settings write replaces the whole value,
/// so two concurrent read-modify-write cycles would lose one of the words.
/// </para>
/// <para>
/// The cap exists because the whole map is rewritten on every addition. It bounds what one note can
/// do to the size of that write, and a note needing more than this many exceptions wants the personal
/// dictionary instead.
/// </para>
/// </summary>
public sealed class NoteIgnoreService : INoteIgnoreService
{
    /// <summary>Where the map is stored.</summary>
    public const string StorageKey = "Proofing.NoteIgnores";

    private readonly ISettingsService _settings;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary<string, List<string>>? _cache;

    public NoteIgnoreService(ISettingsService settings)
    {
        _settings = settings;
    }

    public int MaxWordsPerNote => 200;

    public async Task<IReadOnlyList<string>> ListAsync(string noteId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(noteId))
            return [];

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await LoadAsync().ConfigureAwait(false);
            return all.TryGetValue(noteId, out var words) ? [.. words] : [];
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> AddAsync(string noteId, string word, CancellationToken ct)
    {
        var trimmed = (word ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(noteId) || trimmed.Length == 0)
            return false;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await LoadAsync().ConfigureAwait(false);
            if (!all.TryGetValue(noteId, out var words))
            {
                words = [];
                all[noteId] = words;
            }

            if (words.Contains(trimmed, StringComparer.OrdinalIgnoreCase))
                return true;

            if (words.Count >= MaxWordsPerNote)
                return false;

            words.Add(trimmed);
            await PersistAsync(all).ConfigureAwait(false);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RemoveAsync(string noteId, string word, CancellationToken ct)
    {
        var trimmed = (word ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(noteId) || trimmed.Length == 0)
            return;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await LoadAsync().ConfigureAwait(false);
            if (!all.TryGetValue(noteId, out var words))
                return;

            if (words.RemoveAll(w => string.Equals(w, trimmed, StringComparison.OrdinalIgnoreCase)) == 0)
                return;

            if (words.Count == 0)
                all.Remove(noteId);

            await PersistAsync(all).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyDictionary<string, IReadOnlyList<string>>> GetAllAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await LoadAsync().ConfigureAwait(false);
            var copy = new Dictionary<string, IReadOnlyList<string>>(all.Count, StringComparer.Ordinal);
            foreach (var (noteId, words) in all)
                copy[noteId] = [.. words];
            return copy;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Caller must hold the gate.</summary>
    private async Task<Dictionary<string, List<string>>> LoadAsync()
    {
        if (_cache is not null)
            return _cache;

        var stored = await _settings
            .GetAsync<Dictionary<string, List<string>>?>(StorageKey, null)
            .ConfigureAwait(false);

        _cache = stored is null
            ? new Dictionary<string, List<string>>(StringComparer.Ordinal)
            : new Dictionary<string, List<string>>(stored, StringComparer.Ordinal);

        return _cache;
    }

    /// <summary>Caller must hold the gate.</summary>
    private Task PersistAsync(Dictionary<string, List<string>> all)
    {
        _cache = all;
        return _settings.SetAsync(StorageKey, all);
    }
}
