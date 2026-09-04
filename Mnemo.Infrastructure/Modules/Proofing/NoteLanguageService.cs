using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// Per-note language choices, stored as one settings value keyed by note id.
/// <para>
/// Gated for the same reason the ignore lists are: a settings write replaces the whole value, so two
/// concurrent read-modify-write cycles would lose one of the notes.
/// </para>
/// <para>
/// The cap exists because the whole map is rewritten on every write, and it is checked only when a
/// note that has no entry asks for one. Clearing a note, or rewriting one that is already in the
/// map, cannot grow the value and so is always allowed.
/// </para>
/// </summary>
public sealed class NoteLanguageService : INoteLanguageService
{
    /// <summary>Where the map is stored.</summary>
    public const string StorageKey = "Proofing.NoteLanguages";

    private readonly ISettingsService _settings;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary<string, NoteLanguageEntry>? _cache;

    public NoteLanguageService(ISettingsService settings)
    {
        _settings = settings;
    }

    public int MaxNotes => 500;

    public async Task<NoteLanguageEntry?> GetAsync(string noteId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(noteId))
            return null;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await LoadAsync().ConfigureAwait(false);
            return all.TryGetValue(noteId, out var entry) ? entry : null;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> SetAsync(string noteId, NoteLanguageEntry entry, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(noteId) || entry is null)
            return false;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await LoadAsync().ConfigureAwait(false);
            if (!all.ContainsKey(noteId) && all.Count >= MaxNotes)
                return false;

            all[noteId] = entry;
            await PersistAsync(all).ConfigureAwait(false);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task ClearAsync(string noteId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(noteId))
            return;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await LoadAsync().ConfigureAwait(false);
            if (!all.Remove(noteId))
                return;

            await PersistAsync(all).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Caller must hold the gate.</summary>
    private async Task<Dictionary<string, NoteLanguageEntry>> LoadAsync()
    {
        if (_cache is not null)
            return _cache;

        var stored = await _settings
            .GetAsync<Dictionary<string, NoteLanguageEntry>?>(StorageKey, null)
            .ConfigureAwait(false);

        _cache = stored is null
            ? new Dictionary<string, NoteLanguageEntry>(StringComparer.Ordinal)
            : new Dictionary<string, NoteLanguageEntry>(stored, StringComparer.Ordinal);

        return _cache;
    }

    /// <summary>Caller must hold the gate.</summary>
    private Task PersistAsync(Dictionary<string, NoteLanguageEntry> all)
    {
        _cache = all;
        return _settings.SetAsync(StorageKey, all);
    }
}
