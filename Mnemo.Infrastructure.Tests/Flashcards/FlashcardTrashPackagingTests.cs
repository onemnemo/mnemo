using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What a shared collection carries once the trash exists.
/// </summary>
/// <remarks>
/// A package is content somebody chose to hand to somebody else, so deleted material has no place
/// in it: it is excluded on the way out and cannot be quietly overwritten on the way in.
/// </remarks>
public sealed class FlashcardTrashPackagingTests
{
    [Fact]
    public async Task A_deck_in_the_trash_is_not_in_a_package()
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();
        await AddCardAsync(h, "c1");
        await new FlashcardDeckTrashSource(h.Store).CaptureAsync("deck-1", "e1");

        var exported = await Handler(h).ExportAsync(ExportContext());

        Assert.Equal(0, exported.ItemCount);
    }

    [Fact]
    public async Task A_card_in_the_trash_is_not_in_a_package_of_the_deck_it_sits_in()
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();
        await AddCardAsync(h, "kept");
        await AddCardAsync(h, "deleted");
        await new FlashcardCardTrashSource(h.Store).CaptureAsync("deleted", "e1");

        var exported = await Handler(h).ExportAsync(ExportContext());

        Assert.Equal(1, exported.ItemCount);
        var imported = await ImportIntoFreshCollectionAsync(exported);
        Assert.Equal(1, imported.Cards);
    }

    [Fact]
    public async Task Importing_a_deck_whose_id_the_trash_is_holding_is_reported_as_skipped()
    {
        await using var source = new FlashcardStoreHarness();
        await source.SeedDeckAsync();
        await AddCardAsync(source, "c1");
        var exported = await Handler(source).ExportAsync(ExportContext());

        await using var target = new FlashcardStoreHarness();
        await target.SeedDeckAsync();
        await new FlashcardDeckTrashSource(target.Store).CaptureAsync("deck-1", "e1");

        var result = await Handler(target).ImportAsync(ImportContext(exported));

        // The held deck keeps the id, so the incoming deck has nowhere to be written. Its cards must
        // not be written anyway: they would sit in a deck nobody can open, and would come back with
        // the held deck as though they had always been in it.
        Assert.Equal(0, result.ImportedCount);
        Assert.Equal(1, result.SkippedCount);
        Assert.Equal(0, await CountCardsAsync(target));
    }

    [Theory]
    [InlineData(ImportConflictPolicy.KeepBoth)]
    [InlineData(ImportConflictPolicy.Replace)]
    public async Task Restoring_over_a_card_the_trash_is_holding_leaves_the_held_card_as_it_was(ImportConflictPolicy policy)
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();
        await AddCardAsync(h, "kept");
        await AddCardAsync(h, "held");
        await ScheduleAsync(h, "held", reps: 4, stability: 10, dueInDays: 3);
        var exported = await Handler(h).ExportAsync(ExportContext());

        // Studied on after the backup, then deleted. The trash holds the card with the schedule it
        // had at deletion, which is what a restore from the trash brings back.
        await ScheduleAsync(h, "held", reps: 9, stability: 40, dueInDays: 30);
        await new FlashcardCardTrashSource(h.Store).CaptureAsync("held", "e1");

        var result = await Handler(h).ImportAsync(FlashcardPackageFixture.ImportContext(exported, policy));

        // The package's older schedule must not land on a row the package could not write. Nothing
        // above the schedule can see a held card, and the card row itself is left alone, so the
        // schedule has to be as well.
        var schedule = await ReadScheduleAsync(h, "held");
        Assert.Equal(9, schedule.Reps);
        Assert.Equal(40, schedule.Stability);
        Assert.True(await IsHeldAsync(h, "held"));

        if (policy == ImportConflictPolicy.KeepBoth)
        {
            // A copy is a copy of the whole deck, and the package still carries this card.
            Assert.Equal(1, result.DuplicatedCount);
            var copyDeckId = Assert.Single((await ListDeckIdsAsync(h)).Where(id => id != "deck-1"));
            var copies = await ListLiveCardsAsync(h, copyDeckId);
            Assert.Equal(new[] { "held", "kept" }, copies.Select(c => c.Front).OrderBy(f => f, StringComparer.Ordinal).ToArray());
            var copyOfHeld = copies.Single(c => c.Front == "held");
            Assert.NotEqual("held", copyOfHeld.Id);
            Assert.Equal(4, (await ReadScheduleAsync(h, copyOfHeld.Id)).Reps);
        }
        else
        {
            // Replacing the deck leaves the trash alone: the held card stays where the user put
            // it, and is counted as skipped rather than quietly written over.
            Assert.Equal(1, result.SkippedCount);
            var live = await ListLiveCardsAsync(h, "deck-1");
            Assert.Equal("kept", Assert.Single(live).Front);
        }
    }

    [Fact]
    public async Task Restoring_a_copy_over_material_the_trash_is_holding_gives_the_copy_material_of_its_own()
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var card = await cards.CreateCardAsync(new FlashcardCardDraft(
            "deck-1", FlashcardType.Classic, "front", "back", Array.Empty<string>(), Array.Empty<FlashcardAttachment>()));
        Assert.NotNull(card.FactId);
        var exported = await Handler(h).ExportAsync(ExportContext());

        await new FlashcardFactTrashSource(h.Store).CaptureAsync(card.FactId!, "e1");

        var result = await Handler(h).ImportAsync(FlashcardPackageFixture.ImportContext(exported, ImportConflictPolicy.KeepBoth));

        // The held material keeps its id and its cards keep their layout slots, so the copy needs
        // material of its own for its card to have a slot at all.
        Assert.Equal(1, result.DuplicatedCount);
        var copyDeckId = Assert.Single((await ListDeckIdsAsync(h)).Where(id => id != "deck-1"));
        var copy = Assert.Single(await ListLiveCardsAsync(h, copyDeckId));
        Assert.NotEqual(card.Id, copy.Id);
        Assert.NotEqual(card.FactId, copy.FactId);
        var material = await h.FactService.GetFactForCardAsync(copy.Id);
        Assert.NotNull(material);
        Assert.Equal("front", material.Value(FlashcardCardType.BasicFrontFieldId));
        Assert.True(await IsHeldAsync(h, card.Id));
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    private static FlashcardsMnemoPayloadHandler Handler(FlashcardStoreHarness h) =>
        FlashcardPackageFixture.Handler(h);

    private static MnemoPayloadExportContext ExportContext() => FlashcardPackageFixture.ExportContext();

    private static MnemoPayloadImportContext ImportContext(MnemoPayloadExportData exported) =>
        FlashcardPackageFixture.ImportContext(exported);

    /// <summary>Reads a package back into an empty collection, so its contents can be counted.</summary>
    private static async Task<(int Decks, int Cards)> ImportIntoFreshCollectionAsync(MnemoPayloadExportData exported)
    {
        await using var target = new FlashcardStoreHarness();
        await target.Store.InitializeAsync();
        var result = await Handler(target).ImportAsync(ImportContext(exported));
        return (result.ImportedCount, await CountCardsAsync(target));
    }

    private static Task AddCardAsync(FlashcardStoreHarness h, string cardId)
    {
        var card = FlashcardStoreHarness.Card(cardId, "deck-1", cardId, "back");
        return h.AddCardAsync(card, Core.Models.Flashcards.FlashcardSchedule.NewFor(cardId, h.Time.GetUtcNow()));
    }

    private static Task<int> CountCardsAsync(FlashcardStoreHarness h) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM FlashcardCards;";
            return System.Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
        });

    private static Task ScheduleAsync(FlashcardStoreHarness h, string cardId, int reps, double stability, int dueInDays) =>
        h.Store.WriteAsync((conn, tx, ct) => h.Schedules.UpsertAsync(conn, tx, new FlashcardSchedule(
            cardId, h.Time.GetUtcNow().AddDays(dueInDays), stability, 5, reps, 0, FlashcardFsrsState.Review, 0, h.Time.GetUtcNow()), ct));

    private static async Task<FlashcardSchedule> ReadScheduleAsync(FlashcardStoreHarness h, string cardId)
    {
        var schedule = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, cardId, ct));
        Assert.NotNull(schedule);
        return schedule;
    }

    private static Task<System.Collections.Generic.IReadOnlyList<Flashcard>> ListLiveCardsAsync(FlashcardStoreHarness h, string deckId) =>
        h.Store.ReadAsync((conn, ct) => h.Cards.ListByDeckAsync(conn, deckId, ct));

    private static async Task<string[]> ListDeckIdsAsync(FlashcardStoreHarness h)
    {
        var headers = await h.Store.ReadAsync((conn, ct) => h.Decks.ListHeadersAsync(conn, ct));
        return [.. headers.Select(d => d.Id)];
    }

    private static Task<bool> IsHeldAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM FlashcardCards WHERE Id = $id AND TrashId IS NOT NULL;";
            cmd.Parameters.AddWithValue("$id", cardId);
            return System.Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0) == 1;
        });
}
