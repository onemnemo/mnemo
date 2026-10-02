using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What happens to a card when the thing that made it goes away: an edit that stops a layout
/// firing, a layout taken off the card type, and putting either of them back.
/// </summary>
/// <remarks>
/// The invariant these hold is that no ordinary save destroys a card. A card with nothing behind
/// it is held by the trash, keeps its schedule and its history, and comes back whole once there is
/// a layout to come back to.
/// </remarks>
public sealed class FlashcardCardSweepTests
{
    private static readonly DateTimeOffset Now = new(2026, 5, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Emptying_a_required_field_holds_the_card_in_the_trash_instead_of_destroying_it()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var contextCard = first.Cards.Single(c => c.LayoutKey == "in-context").Id;

        var second = await SaveVocabularyAsync(h, "Haus", "house", string.Empty, first.Fact.Id);

        Assert.Equal(1, second.Removed);
        Assert.DoesNotContain(second.Cards, c => c.Id == contextCard);
        Assert.Null(await LiveCardAsync(h, contextCard));

        var entry = Assert.Single(await h.HeldAsync());
        Assert.Equal(FlashcardCardTrashSource.TrashKind, entry.Kind);
        Assert.Equal(contextCard, entry.ItemId);
    }

    [Fact]
    public async Task A_card_the_sweep_took_keeps_the_schedule_it_had_been_building()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var contextCard = first.Cards.Single(c => c.LayoutKey == "in-context").Id;
        await StudyAsync(h, contextCard, reps: 6);

        await SaveVocabularyAsync(h, "Haus", "house", string.Empty, first.Fact.Id);

        var schedule = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, contextCard, ct));
        Assert.NotNull(schedule);
        Assert.Equal(6, schedule!.Reps);
    }

    [Fact]
    public async Task Filling_the_field_again_brings_the_card_back_with_its_history()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var contextCard = first.Cards.Single(c => c.LayoutKey == "in-context").Id;
        await StudyAsync(h, contextCard, reps: 6);
        await SaveVocabularyAsync(h, "Haus", "house", string.Empty, first.Fact.Id);

        var entry = Assert.Single(await h.HeldAsync());
        var restored = Assert.Single(await h.Trash.RestoreAsync([entry.Id]));

        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
        var card = await LiveCardAsync(h, contextCard);
        Assert.NotNull(card);
        Assert.Equal("in-context", card!.LayoutKey);
        var schedule = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, contextCard, ct));
        Assert.Equal(6, schedule!.Reps);
    }

    [Fact]
    public async Task Taking_a_layout_off_the_type_holds_every_card_it_made()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var production = first.Cards.Single(c => c.LayoutKey == "production").Id;

        await SaveVocabularyTypeAsync(h, WithoutProduction(await VocabularyAsync(h)));

        Assert.Null(await LiveCardAsync(h, production));
        var entry = Assert.Single(await h.HeldAsync());
        Assert.Equal(production, entry.ItemId);
        Assert.NotNull(await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, production, ct)));
    }

    [Fact]
    public async Task Taking_a_layout_off_many_facts_holds_the_cards_as_one_batch()
    {
        await using var h = await OpenAsync();
        await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        await SaveVocabularyAsync(h, "Buch", "book", "Das Buch ist neu.");
        await SaveVocabularyAsync(h, "Zeit", "time", "Die Zeit vergeht.");

        await SaveVocabularyTypeAsync(h, WithoutProduction(await VocabularyAsync(h)));

        var held = await h.HeldAsync();
        Assert.Equal(3, held.Count);
        Assert.Single(held.Select(entry => entry.BatchId).Distinct(StringComparer.Ordinal));
        Assert.All(held, entry => Assert.Equal(FlashcardCardTrashSource.TrashKind, entry.Kind));
    }

    [Fact]
    public async Task A_card_whose_layout_left_the_type_cannot_be_restored_and_stays_in_the_trash()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var production = first.Cards.Single(c => c.LayoutKey == "production").Id;
        await SaveVocabularyTypeAsync(h, WithoutProduction(await VocabularyAsync(h)));

        var entry = Assert.Single(await h.HeldAsync());
        var refused = Assert.Single(await h.Trash.RestoreAsync([entry.Id]));

        Assert.Equal(TrashRestoreOutcome.NoLongerGenerated, refused.Outcome);
        Assert.Null(await LiveCardAsync(h, production));
        Assert.Equal(entry.Id, Assert.Single(await h.HeldAsync()).Id);
    }

    [Fact]
    public async Task Putting_the_layout_back_on_the_type_makes_the_restore_work_again()
    {
        await using var h = await OpenAsync();
        var stored = await VocabularyAsync(h);
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var production = first.Cards.Single(c => c.LayoutKey == "production").Id;
        await SaveVocabularyTypeAsync(h, WithoutProduction(stored));

        await SaveVocabularyTypeAsync(h, stored);

        var entry = Assert.Single(await h.HeldAsync());
        var restored = Assert.Single(await h.Trash.RestoreAsync([entry.Id]));

        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
        Assert.NotNull(await LiveCardAsync(h, production));
    }

    [Fact]
    public async Task A_card_restored_under_a_layout_that_is_gone_is_never_the_state_a_save_can_reach()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var production = first.Cards.Single(c => c.LayoutKey == "production").Id;
        await SaveVocabularyTypeAsync(h, WithoutProduction(await VocabularyAsync(h)));
        var entry = Assert.Single(await h.HeldAsync());
        await h.Trash.RestoreAsync([entry.Id]);

        // The refused restore left the card held, so an ordinary save of the material has nothing
        // to sweep and the card is still there to get back once the layout returns.
        await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.", first.Fact.Id);

        Assert.Equal(entry.Id, Assert.Single(await h.HeldAsync()).Id);
        Assert.NotNull(await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, production, ct)));
    }

    [Fact]
    public async Task A_cloze_card_is_declined_while_its_deletion_is_gone_and_comes_back_with_it()
    {
        await using var h = await OpenAsync();
        var first = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.");
        var second = first.Cards.Single(c => c.LayoutKey == "c2").Id;
        await StudyAsync(h, second, reps: 4);

        await SaveClozeAsync(h, "{{c1::Paris}} is the capital of France.", first.Fact.Id);

        var entry = Assert.Single(await h.HeldAsync());
        Assert.Equal(second, entry.ItemId);
        var refused = Assert.Single(await h.Trash.RestoreAsync([entry.Id]));
        Assert.Equal(TrashRestoreOutcome.NoLongerGenerated, refused.Outcome);
        Assert.Null(await LiveCardAsync(h, second));
        Assert.Equal(entry.Id, Assert.Single(await h.HeldAsync()).Id);

        // Putting the deletion back is itself the restore: the save takes the held card back, so
        // the deck never holds one card fewer than the editor shows.
        var resaved = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.", first.Fact.Id);

        Assert.Equal(2, resaved.Cards.Count);
        Assert.Equal(0, resaved.Added);
        Assert.Empty(await h.HeldAsync());
        var card = await LiveCardAsync(h, second);
        Assert.NotNull(card);
        Assert.Equal("c2", card!.LayoutKey);
        var schedule = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, second, ct));
        Assert.Equal(4, schedule!.Reps);
        var liveSecond = await h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT COUNT(*) FROM FlashcardCards
                WHERE FactId = $fact AND LayoutKey = 'c2' AND TrashId IS NULL;
                """;
            cmd.Parameters.AddWithValue("$fact", first.Fact.Id);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        });
        Assert.Equal(1, liveSecond);
    }

    [Fact]
    public async Task A_cloze_card_being_purged_is_not_taken_back_when_its_deletion_comes_back()
    {
        await using var h = await OpenAsync();
        var first = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.");
        var second = first.Cards.Single(c => c.LayoutKey == "c2").Id;
        await SaveClozeAsync(h, "{{c1::Paris}} is the capital of France.", first.Fact.Id);
        var entry = Assert.Single(await h.HeldAsync());
        // The trash commits the purging state before the source deletes, so a save can land between.
        await SetLedgerStateAsync(h, entry.Id, "purging");

        var resaved = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.", first.Fact.Id);

        Assert.Equal(0, resaved.Added);
        Assert.Null(await LiveCardAsync(h, second));
        var purge = await h.Trash.PurgeAsync(entry.Id);
        Assert.True(purge.Purged);
        var remaining = await h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM FlashcardCards WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", second);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        });
        Assert.Equal(0, remaining);
    }

    [Fact]
    public async Task A_cloze_card_whose_capture_stopped_before_promotion_comes_back_with_its_deletion()
    {
        await using var h = await OpenAsync();
        var first = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.");
        var second = first.Cards.Single(c => c.LayoutKey == "c2").Id;
        await SaveClozeAsync(h, "{{c1::Paris}} is the capital of France.", first.Fact.Id);
        var entry = Assert.Single(await h.HeldAsync());
        await SetLedgerStateAsync(h, entry.Id, "prepared");

        var resaved = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.", first.Fact.Id);

        Assert.Equal(0, resaved.Added);
        Assert.NotNull(await LiveCardAsync(h, second));
        Assert.Equal(0, await LedgerRowsAsync(h, entry.Id));
    }

    [Fact]
    public async Task Refilling_a_required_field_takes_the_held_card_back_with_its_history_and_the_new_wording()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var contextCard = first.Cards.Single(c => c.LayoutKey == "in-context").Id;
        await StudyAsync(h, contextCard, reps: 6);
        await SaveVocabularyAsync(h, "Haus", "house", string.Empty, first.Fact.Id);
        Assert.Single(await h.HeldAsync());

        var refilled = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist neu.", first.Fact.Id);

        Assert.Equal(first.Cards.Count, refilled.Cards.Count);
        Assert.Empty(await h.HeldAsync());
        var card = await LiveCardAsync(h, contextCard);
        Assert.NotNull(card);
        Assert.Contains("neu", card!.Front + card.Back, StringComparison.Ordinal);
        var schedule = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, contextCard, ct));
        Assert.Equal(6, schedule!.Reps);
    }

    [Fact]
    public async Task Taking_a_card_back_removes_only_its_own_ledger_row()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        await SaveVocabularyAsync(h, "Haus", "house", string.Empty, first.Fact.Id);
        // A row no source explains, which only a full reconcile would drop.
        await h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO TrashEntries
                SELECT 'stray', Kind, 'stray-item', Title, Origin, ContainedCount, 'stray-batch', State, DeletedAt, ExpiresAt
                FROM TrashEntries LIMIT 1;
                """;
            return await cmd.ExecuteNonQueryAsync(ct);
        });
        Assert.Equal(2, (await h.HeldAsync()).Count);

        await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist neu.", first.Fact.Id);

        Assert.Equal("stray", Assert.Single(await h.HeldAsync()).Id);
    }

    [Fact]
    public async Task A_cloze_card_the_person_deleted_stays_deleted_when_its_deletion_goes_and_comes_back()
    {
        await using var h = await OpenAsync();
        var first = await SaveClozeAsync(h, "{{c1::Paris}} is in {{c2::France}}.");
        var second = first.Cards.Single(c => c.LayoutKey == "c2").Id;
        await h.Trash.DeleteAsync([new TrashDeleteRequest(FlashcardCardTrashSource.TrashKind, second)]);
        var entry = Assert.Single(await h.HeldAsync());

        await SaveClozeAsync(h, "{{c1::Paris}} is in France.", first.Fact.Id);
        await SaveClozeAsync(h, "{{c1::Paris}} is in {{c2::France}}.", first.Fact.Id);

        Assert.Null(await LiveCardAsync(h, second));
        Assert.Equal(entry.Id, Assert.Single(await h.HeldAsync()).Id);
    }

    [Fact]
    public async Task A_card_the_person_deleted_stays_deleted_when_its_required_field_is_emptied_and_refilled()
    {
        await using var h = await OpenAsync();
        var first = await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist alt.");
        var contextCard = first.Cards.Single(c => c.LayoutKey == "in-context").Id;
        await h.Trash.DeleteAsync([new TrashDeleteRequest(FlashcardCardTrashSource.TrashKind, contextCard)]);
        var entry = Assert.Single(await h.HeldAsync());

        await SaveVocabularyAsync(h, "Haus", "house", string.Empty, first.Fact.Id);
        await SaveVocabularyAsync(h, "Haus", "house", "Das Haus ist neu.", first.Fact.Id);

        Assert.Null(await LiveCardAsync(h, contextCard));
        Assert.Equal(entry.Id, Assert.Single(await h.HeldAsync()).Id);
    }

    [Fact]
    public async Task A_card_held_with_its_deck_is_not_taken_back_by_a_save_of_its_material()
    {
        await using var h = await OpenAsync();
        var first = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.");
        var second = first.Cards.Single(c => c.LayoutKey == "c2").Id;

        // Filed in a second deck on its own, and that deck deleted: the card is held with the deck.
        await h.SeedDeckAsync("deck-2");
        await h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await using var move = conn.CreateCommand();
            move.Transaction = tx;
            move.CommandText = "UPDATE FlashcardCards SET DeckId = 'deck-2' WHERE Id = $id;";
            move.Parameters.AddWithValue("$id", second);
            await move.ExecuteNonQueryAsync(ct);
        });
        await h.Trash.DeleteAsync([new TrashDeleteRequest(FlashcardDeckTrashSource.TrashKind, "deck-2")]);

        await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}} today.", first.Fact.Id);

        Assert.Null(await LiveCardAsync(h, second));
        Assert.Single(await h.HeldAsync());
    }

    [Theory]
    [InlineData("{{c1::Paris}} is the capital of France in {{c3::Europe}}.")]
    [InlineData("{{c1::Paris}} is the capital of France in Europe.")]
    public async Task A_save_cancelled_right_after_the_sweep_still_leaves_each_card_marked_as_swept(string edited)
    {
        await using var h = await OpenAsync();
        const string original = "{{c1::Paris}} is the capital of {{c2::France}} in {{c3::Europe}}.";
        var first = await SaveClozeAsync(h, original);
        using var exit = new CancellationTokenSource();
        var cancelling = new FlashcardFactService(
            h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock, new CancelAfterDelete(h.Trash, exit));

        try
        {
            await cancelling.SaveFactAsync(ClozeDraft(edited, first.Fact.Id), exit.Token);
        }
        catch (OperationCanceledException)
        {
            // Only what the capture committed matters, not which later step saw the exit.
        }

        // One edit sweeps a single card, the other two cards through the batched capture.
        var held = await h.HeldAsync();
        Assert.NotEmpty(held);
        foreach (var entry in held)
            Assert.Equal(entry.Id, await SweptTrashIdAsync(h, entry.ItemId));

        await SaveClozeAsync(h, original, first.Fact.Id);
        Assert.Empty(await h.HeldAsync());
        foreach (var card in first.Cards)
            Assert.NotNull(await LiveCardAsync(h, card.Id));
    }

    [Fact]
    public async Task A_delete_after_a_sweep_is_not_marked_as_swept()
    {
        await using var h = await OpenAsync();
        var first = await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.");
        await SaveClozeAsync(h, "{{c1::Paris}} is the capital of France.", first.Fact.Id);
        Assert.Single(await h.HeldAsync());

        // The sweep flag must end with the sweep, so a later delete in the same flow is the person's.
        var kept = first.Cards.Single(c => c.LayoutKey == "c1").Id;
        await h.Trash.DeleteAsync([new TrashDeleteRequest(FlashcardCardTrashSource.TrashKind, kept)]);

        Assert.Null(await SweptTrashIdAsync(h, kept));
    }

    private static Task<int> SetLedgerStateAsync(FlashcardStoreHarness h, string entryId, string state) =>
        h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE TrashEntries SET State = $state WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$state", state);
            cmd.Parameters.AddWithValue("$id", entryId);
            return await cmd.ExecuteNonQueryAsync(ct);
        });

    private static Task<int> LedgerRowsAsync(FlashcardStoreHarness h, string entryId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM TrashEntries WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", entryId);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        });

    private static Task<string?> SweptTrashIdAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT SweptTrashId FROM FlashcardCards WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", cardId);
            return await cmd.ExecuteScalarAsync(ct) as string;
        });

    /// <summary>The trash, with the exit arriving the moment a delete has been captured.</summary>
    private sealed class CancelAfterDelete(ITrashService inner, CancellationTokenSource exit) : ITrashService
    {
        public IReadOnlyCollection<string> RegisteredKinds => inner.RegisteredKinds;

        public async Task<TrashAction> DeleteAsync(
            IReadOnlyCollection<TrashDeleteRequest> items, CancellationToken cancellationToken = default)
        {
            var action = await inner.DeleteAsync(items, cancellationToken);
            await exit.CancelAsync();
            return action;
        }

        public Task<TrashPage> ListAsync(TrashListQuery query, CancellationToken cancellationToken = default) =>
            inner.ListAsync(query, cancellationToken);

        public Task<int> CountAsync(CancellationToken cancellationToken = default) =>
            inner.CountAsync(cancellationToken);

        public Task<IReadOnlyList<TrashRestoreResult>> RestoreAsync(
            IReadOnlyCollection<string> entryIds,
            TrashRestoreTarget? target = null,
            CancellationToken cancellationToken = default) =>
            inner.RestoreAsync(entryIds, target, cancellationToken);

        public Task<IReadOnlyList<TrashRestoreResult>> RestoreBatchAsync(
            string batchId, CancellationToken cancellationToken = default) =>
            inner.RestoreBatchAsync(batchId, cancellationToken);

        public Task<TrashPurgeResult> PurgeAsync(string entryId, CancellationToken cancellationToken = default) =>
            inner.PurgeAsync(entryId, cancellationToken);

        public Task<TrashEmptyResult> EmptyAsync(CancellationToken cancellationToken = default) =>
            inner.EmptyAsync(cancellationToken);

        public Task<int> SweepExpiredAsync(CancellationToken cancellationToken = default) =>
            inner.SweepExpiredAsync(cancellationToken);

        public Task ReconcileAsync(CancellationToken cancellationToken = default) =>
            inner.ReconcileAsync(cancellationToken);
    }

    private static FlashcardFactDraft ClozeDraft(string text, string? id) =>
        new(
            id,
            "deck-1",
            FlashcardCardType.ClozeId,
            new Dictionary<string, string> { [FlashcardCardType.ClozeTextFieldId] = text },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
            []);

    private static Task<FlashcardFactSaved> SaveClozeAsync(FlashcardStoreHarness h, string text, string? id = null) =>
        h.FactService.SaveFactAsync(ClozeDraft(text, id));

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    private static async Task<FlashcardCardType> VocabularyAsync(FlashcardStoreHarness h)
    {
        var type = await h.FactService.GetCardTypeAsync(FlashcardCardType.VocabularyId);
        Assert.NotNull(type);
        return type!;
    }

    private static FlashcardCardType WithoutProduction(FlashcardCardType type) =>
        type with { Layouts = [.. type.Layouts.Where(layout => layout.Id != "production")] };

    private static Task<FlashcardCardType> SaveVocabularyTypeAsync(FlashcardStoreHarness h, FlashcardCardType type) =>
        h.FactService.SaveCardTypeAsync(type);

    private static Task<FlashcardFactSaved> SaveVocabularyAsync(
        FlashcardStoreHarness h, string word, string meaning, string example, string? id = null) =>
        h.FactService.SaveFactAsync(new FlashcardFactDraft(
            id,
            "deck-1",
            FlashcardCardType.VocabularyId,
            new Dictionary<string, string> { ["word"] = word, ["meaning"] = meaning, ["example"] = example },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
            []));

    private static Task<Flashcard?> LiveCardAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct));

    private static Task StudyAsync(FlashcardStoreHarness h, string cardId, int reps) =>
        h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            var schedule = await h.Schedules.GetAsync(conn, cardId, ct);
            await h.Schedules.UpsertAsync(conn, tx, schedule! with
            {
                Reps = reps,
                Stability = 12.5,
                Difficulty = 4.5,
                FsrsState = FlashcardFsrsState.Review,
            }, ct);
        });
}
