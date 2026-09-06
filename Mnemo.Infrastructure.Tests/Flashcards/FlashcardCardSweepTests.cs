using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
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

        await SaveClozeAsync(h, "{{c1::Paris}} is the capital of {{c2::France}}.", first.Fact.Id);

        var restored = Assert.Single(await h.Trash.RestoreAsync([entry.Id]));
        Assert.Equal(TrashRestoreOutcome.Restored, restored.Outcome);
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

    private static Task<FlashcardFactSaved> SaveClozeAsync(FlashcardStoreHarness h, string text, string? id = null) =>
        h.FactService.SaveFactAsync(new FlashcardFactDraft(
            id,
            "deck-1",
            FlashcardCardType.ClozeId,
            new Dictionary<string, string> { [FlashcardCardType.ClozeTextFieldId] = text },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
            []));

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
