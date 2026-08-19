using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Optimizer;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardPresetService : IFlashcardPresetService
{
    private readonly IFlashcardStore _store;
    private readonly IPresetRepository _presets;
    private readonly IDeckRepository _decks;
    private readonly FlashcardClock _clock;

    public FlashcardPresetService(IFlashcardStore store, IPresetRepository presets, IDeckRepository decks, FlashcardClock clock)
    {
        _store = store;
        _presets = presets;
        _decks = decks;
        _clock = clock;
    }

    public Task<IReadOnlyList<FlashcardPreset>> ListPresetsAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _presets.ListAsync(conn, ct), cancellationToken);

    public Task<FlashcardPreset?> GetPresetAsync(string presetId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _presets.GetAsync(conn, presetId, ct), cancellationToken);

    public async Task<FlashcardPreset> GetOrCreateStandardAsync(CancellationToken cancellationToken = default)
    {
        var existing = await GetPresetAsync(FlashcardPreset.StandardPresetId, cancellationToken).ConfigureAwait(false);
        if (existing is not null)
            return existing;

        var standard = FlashcardPreset.CreateStandard(_clock.Now);
        await _store.WriteAsync((conn, tx, ct) => _presets.UpsertAsync(conn, tx, standard, ct), cancellationToken).ConfigureAwait(false);
        return standard;
    }

    /// <remarks>
    /// This is the only way a preset reaches the store, so it is where the weight vector is checked.
    /// The scheduler validates a vector's length but not its values, and a weight far enough out of
    /// range drives stability to NaN, which SQLite cannot hold: the column lands NULL and the card's
    /// memory state silently resets to a new card's. Refusing the write is the only outcome that
    /// keeps that from being irreversible.
    /// </remarks>
    public async Task<FlashcardPreset> SavePresetAsync(FlashcardPreset preset, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(preset);
        if (!FsrsWeightRules.TryValidate(preset.Weights, out var weightError))
            throw new ArgumentException(weightError, nameof(preset));

        var now = _clock.Now;
        var toSave = preset with
        {
            CreatedAt = preset.CreatedAt == default ? now : preset.CreatedAt,
            UpdatedAt = now
        };
        await _store.WriteAsync((conn, tx, ct) => _presets.UpsertAsync(conn, tx, toSave, ct), cancellationToken).ConfigureAwait(false);
        return toSave;
    }

    public Task AssignDeckPresetAsync(string deckId, string presetId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _decks.SetPresetAsync(conn, tx, deckId, presetId, _clock.Now, ct), cancellationToken);

    public Task<int> CountDecksUsingAsync(string presetId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _presets.CountDecksUsingAsync(conn, presetId, ct), cancellationToken);

    public async Task<bool> DeletePresetAsync(string presetId, CancellationToken cancellationToken = default)
    {
        var inUse = await CountDecksUsingAsync(presetId, cancellationToken).ConfigureAwait(false);
        if (inUse > 0)
            return false; // block deletion while decks still reference it
        return await _store.WriteAsync((conn, tx, ct) => _presets.DeleteAsync(conn, tx, presetId, ct), cancellationToken).ConfigureAwait(false);
    }
}
