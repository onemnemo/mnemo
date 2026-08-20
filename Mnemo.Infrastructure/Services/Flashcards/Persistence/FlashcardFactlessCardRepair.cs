using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Gives material back to the cards an earlier build's legacy import wrote without any.
/// </summary>
public interface IFlashcardFactlessCardRepair
{
    /// <summary>
    /// Sweeps the collection once. Does nothing on an install the legacy import never ran on, and
    /// nothing at all on a later start. Safe to call any number of times.
    /// </summary>
    Task RepairAsync(CancellationToken cancellationToken = default);
}

/// <inheritdoc />
/// <remarks>
/// <para>
/// An earlier build imported the legacy collection after the upgrade step that gives a card its
/// fact had already run, so every card it wrote stayed without material permanently. Fixing the
/// import only helps a collection that has not been imported yet; this is what reaches the ones
/// that already were.
/// </para>
/// <para>
/// It runs once, guarded by a stored mark, and only where the legacy import left its backup behind.
/// Both guards matter. Off that population a card with no material is one the app made that way on
/// purpose: deleting material a card in the trash was made from cuts that card loose so it survives
/// as its own wording rather than going down with the material, and handing it fresh material back
/// would overrule a decision somebody made.
/// </para>
/// <para>
/// Held rows are swept along with live ones. The sweep happens once, so a card left out of it is a
/// card that comes back from the trash still unable to be buried or edited, with nothing left to
/// fix it. What the sweep adds for a held card is then put where the trash expects it, rather than
/// appearing in the collection while the card it came from is still deleted.
/// </para>
/// </remarks>
public sealed class FlashcardFactlessCardRepair : IFlashcardFactlessCardRepair
{
    /// <summary>What the legacy import leaves behind, and so proof that it ran here.</summary>
    private const string BackupKey = "flashcards.state.v2.migrated-backup";

    internal const string MarkKey = "flashcards.factless-card-repair";
    internal const int MarkVersion = 1;

    private readonly IFlashcardStore _store;
    private readonly IStorageProvider _storage;
    private readonly ILoggerService _logger;
    private readonly TimeProvider _time;

    /// <param name="time">Clock the repaired rows are stamped from. Defaults to the system clock.</param>
    public FlashcardFactlessCardRepair(
        IFlashcardStore store,
        IStorageProvider storage,
        ILoggerService logger,
        TimeProvider? time = null)
    {
        _store = store;
        _storage = storage;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    /// <inheritdoc />
    public async Task RepairAsync(CancellationToken cancellationToken = default)
    {
        var mark = await _storage.LoadAsync<RepairMark>(MarkKey).ConfigureAwait(false);
        if (mark.IsSuccess && mark.Value is not null)
            return;

        await _store.InitializeAsync(cancellationToken).ConfigureAwait(false);

        var backup = await _storage.LoadAsync<LegacyImportBackup>(BackupKey).ConfigureAwait(false);
        if (!backup.IsSuccess || backup.Value is null)
        {
            await MarkDoneAsync(0).ConfigureAwait(false);
            return;
        }

        int repaired;
        try
        {
            repaired = await _store.WriteAsync(SweepAsync, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Left unmarked on purpose: the write rolled back whole, so the next start finds the
            // same collection and tries again rather than leaving it broken behind a mark.
            _logger.Error("Flashcards", "Repair of imported cards without material failed; it will be retried.", ex);
            throw;
        }

        await MarkDoneAsync(repaired).ConfigureAwait(false);
        if (repaired > 0)
            _logger.Info("Flashcards", $"Gave material back to {repaired} imported card(s) that had none.");
    }

    private async Task<int> SweepAsync(SqliteConnection conn, SqliteTransaction tx, CancellationToken cancellationToken)
    {
        var damaged = await ReadFactlessCardsAsync(conn, tx, cancellationToken).ConfigureAwait(false);
        if (damaged.Count == 0)
            return 0;

        await FlashcardFactBackfill
            .ApplyAsync(new FlashcardMigrationContext(conn, tx, _time, cancellationToken))
            .ConfigureAwait(false);

        foreach (var card in damaged)
        {
            if (card.TrashId is null)
                continue;
            await HoldRepairedRowsAsync(conn, tx, card, cancellationToken).ConfigureAwait(false);
        }

        return damaged.Count;
    }

    /// <summary>Every card with no material behind it, and the trash entry holding it if there is one.</summary>
    /// <remarks>
    /// Deliberately not a live-only read. See the note on the class about why a held card cannot be
    /// left for a later pass that never comes.
    /// </remarks>
    private static async Task<List<FactlessCard>> ReadFactlessCardsAsync(
        SqliteConnection conn, SqliteTransaction tx, CancellationToken cancellationToken)
    {
        var cards = new List<FactlessCard>();
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT Id, TrashId FROM FlashcardCards WHERE FactId IS NULL ORDER BY rowid;";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            cards.Add(new FactlessCard(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1)));

        return cards;
    }

    /// <summary>
    /// Puts what the sweep added for a held card where the trash expects it.
    /// </summary>
    /// <remarks>
    /// Material holding several deletions becomes one card per deletion, so a held cloze card gains
    /// cards that would otherwise turn up live in a deck while the card they came from is deleted.
    /// They are held by the same entry instead, which is what restoring the entry then gives back.
    /// The material itself follows the rule the trash already applies to material with no live card:
    /// held exactly when the deck it is filed under is, so nothing live points at a deck nobody can
    /// see, and a card deleted on its own leaves its material where everything else can still reach it.
    /// </remarks>
    private static async Task HoldRepairedRowsAsync(
        SqliteConnection conn, SqliteTransaction tx, FactlessCard card, CancellationToken cancellationToken)
    {
        await using (var siblings = conn.CreateCommand())
        {
            siblings.Transaction = tx;
            siblings.CommandText = """
                UPDATE FlashcardCards SET TrashId = $trash
                WHERE TrashId IS NULL
                  AND FactId = (SELECT source.FactId FROM FlashcardCards source WHERE source.Id = $id);
                """;
            siblings.Parameters.AddWithValue("$trash", card.TrashId);
            siblings.Parameters.AddWithValue("$id", card.Id);
            await siblings.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using var material = conn.CreateCommand();
        material.Transaction = tx;
        material.CommandText = """
            UPDATE FlashcardFacts
            SET TrashId = (SELECT d.TrashId FROM FlashcardDecks d WHERE d.Id = FlashcardFacts.DeckId)
            WHERE TrashId IS NULL
              AND Id = (SELECT source.FactId FROM FlashcardCards source WHERE source.Id = $id);
            """;
        material.Parameters.AddWithValue("$id", card.Id);
        await material.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private Task MarkDoneAsync(int repaired) =>
        _storage.SaveAsync(MarkKey, new RepairMark(MarkVersion, _time.GetUtcNow(), repaired));

    private sealed record FactlessCard(string Id, string? TrashId);

    /// <param name="Version">Marker format version, so a later pass can recognise this one.</param>
    /// <param name="CompletedAtUtc">When the sweep finished.</param>
    /// <param name="Repaired">How many cards it found without material.</param>
    internal sealed record RepairMark(int Version, DateTimeOffset CompletedAtUtc, int Repaired);

    /// <summary>Whether the legacy import ran is the whole question, so its backup is read
    /// through a shape that keeps none of it.</summary>
    private sealed record LegacyImportBackup;
}
