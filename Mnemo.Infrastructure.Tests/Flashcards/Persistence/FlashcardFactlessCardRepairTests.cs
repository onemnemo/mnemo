using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Repairing a collection an earlier build imported without giving any of its cards material.
/// </summary>
/// <remarks>
/// The damage is written the way that build wrote it: a card row with no fact behind it, next to the
/// backup the legacy import leaves. Everything interesting is about what the sweep is allowed to
/// touch, so the trash cases carry as much weight here as the plain one.
/// </remarks>
public sealed class FlashcardFactlessCardRepairTests
{
    private const string BackupKey = "flashcards.state.v2.migrated-backup";
    private static readonly DateTimeOffset Now = new(2026, 5, 6, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Repair_GivesMaterialBack_ToACardAnEarlierImportLeftWithout()
    {
        await using var h = await DamagedStoreAsync();
        await AddFactlessCardAsync(h, "card-1", "Amiodarone", "Class III");
        var storage = ImportedStorage();

        await Repair(h, storage).RepairAsync();

        var card = await h.Store.ReadAsync((c, ct) => h.Cards.GetAsync(c, "card-1", ct));
        Assert.NotNull(card!.FactId);
        Assert.Equal(FlashcardCardType.RecognitionLayoutId, card.LayoutKey);

        var fact = await h.Store.ReadAsync((c, ct) => h.Facts.GetAsync(c, card.FactId!, ct));
        Assert.Equal(FlashcardCardType.BasicId, fact!.TypeId);
        Assert.Equal("Amiodarone", fact.Value(FlashcardCardType.BasicFrontFieldId));
        Assert.Equal("Class III", fact.Value(FlashcardCardType.BasicBackFieldId));
    }

    [Fact]
    public async Task Repair_RunTwice_ChangesNothingTheSecondTime()
    {
        await using var h = await DamagedStoreAsync();
        await AddFactlessCardAsync(h, "card-1", "{{c1::Amiodarone}} is class {{c2::III}}", "Potassium", FlashcardType.Cloze);
        await AddFactlessCardAsync(h, "card-2", "Digoxin", "Cardiac glycoside");
        var storage = ImportedStorage();
        var repair = Repair(h, storage);

        await repair.RepairAsync();
        var first = await ShapeAsync(h);

        await repair.RepairAsync();

        Assert.Equal(first, await ShapeAsync(h));
        Assert.Equal(3, first.Count); // the cloze card became two, the plain one stayed one
    }

    [Fact]
    public async Task Repair_LeavesTheCollectionAlone_WhenNoLegacyImportEverRan()
    {
        // Off that population a card with no material is one the app made that way: cutting a card
        // in the trash loose from material somebody deleted is what leaves it carrying only its own
        // wording, and handing it fresh material back would overrule that.
        await using var h = await DamagedStoreAsync();
        await AddFactlessCardAsync(h, "card-1", "Amiodarone", "Class III");
        var storage = new InMemoryStorageProvider();

        await Repair(h, storage).RepairAsync();

        var card = await h.Store.ReadAsync((c, ct) => h.Cards.GetAsync(c, "card-1", ct));
        Assert.Null(card!.FactId);
    }

    [Fact]
    public async Task Repair_HoldsTheCardsItAdds_ForACardTheTrashIsHolding()
    {
        await using var h = await DamagedStoreAsync();
        await AddFactlessCardAsync(h, "card-1", "{{c1::Amiodarone}} is class {{c2::III}}", "Potassium", FlashcardType.Cloze);
        var storage = ImportedStorage();
        await new FlashcardCardTrashSource(h.Store).CaptureAsync("card-1", "e1");

        await Repair(h, storage).RepairAsync();

        // Both deletions belong to the entry: one of them turning up live in the deck would be the
        // collection growing a card out of something the user deleted.
        var cards = await ShapeAsync(h);
        Assert.Equal(2, cards.Count);
        Assert.All(cards, c => Assert.Equal("e1", c.TrashId));

        // Material sits above cards in the trash, so a card entry that also held its material would
        // stop reading as a card entry at all.
        var factId = cards[0].FactId;
        Assert.NotNull(factId);
        Assert.Null(await TrashIdOfFactAsync(h, factId!));
    }

    [Fact]
    public async Task Repair_LetsARestoredCardComeBackWithTheMaterialItNowHas()
    {
        await using var h = await DamagedStoreAsync();
        await AddFactlessCardAsync(h, "card-1", "Amiodarone", "Class III");
        var storage = ImportedStorage();
        var cards = new FlashcardCardTrashSource(h.Store);
        await cards.CaptureAsync("card-1", "e1");

        await Repair(h, storage).RepairAsync();
        await cards.RestoreAsync("e1");

        var restored = await h.Store.ReadAsync((c, ct) => h.Cards.GetAsync(c, "card-1", ct));
        Assert.NotNull(restored);
        Assert.NotNull(restored!.FactId);
        Assert.NotNull(await h.Store.ReadAsync((c, ct) => h.Facts.GetAsync(c, restored.FactId!, ct)));
    }

    [Fact]
    public async Task Repair_HoldsTheMaterial_WhenTheDeckItIsFiledUnderIsHeld()
    {
        await using var h = await DamagedStoreAsync();
        await AddFactlessCardAsync(h, "card-1", "Amiodarone", "Class III");
        var storage = ImportedStorage();
        var decks = new FlashcardDeckTrashSource(h.Store);
        await decks.CaptureAsync("deck-1", "e1");

        await Repair(h, storage).RepairAsync();

        // Material with no live card under a held deck is held by the same entry, which is what keeps
        // anything the library can still see from pointing at a deck nobody can reach.
        var factId = (await ShapeAsync(h)).Single().FactId;
        Assert.Equal("e1", await TrashIdOfFactAsync(h, factId!));

        await decks.RestoreAsync("e1");
        var restored = await h.Store.ReadAsync((c, ct) => h.Cards.GetAsync(c, "card-1", ct));
        Assert.NotNull(restored);
        Assert.NotNull(await h.Store.ReadAsync((c, ct) => h.Facts.GetAsync(c, restored!.FactId!, ct)));
    }

    // ---- Setup -----------------------------------------------------------------------------------

    private static FlashcardFactlessCardRepair Repair(FlashcardStoreHarness h, InMemoryStorageProvider storage) =>
        new(h.Store, storage, new TestLogger(), h.Time);

    /// <summary>Storage carrying the backup the legacy import leaves, which is what proves it ran.</summary>
    private static InMemoryStorageProvider ImportedStorage()
    {
        var storage = new InMemoryStorageProvider();
        storage.Seed(BackupKey, """{"Folders":[],"Decks":[],"SessionHistory":[]}""");
        return storage;
    }

    private static async Task<FlashcardStoreHarness> DamagedStoreAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    /// <summary>Writes a card the way the build with the defect wrote one: no material behind it.</summary>
    private static Task AddFactlessCardAsync(
        FlashcardStoreHarness h, string id, string front, string back,
        FlashcardType type = FlashcardType.Classic) =>
        h.AddCardAsync(
            new Flashcard(
                id, "deck-1", type, front, back, Array.Empty<string>(), FlashcardCardState.Active,
                false, Array.Empty<FlashcardAttachment>(), null, null, null, Now, Now),
            FlashcardSchedule.NewFor(id, Now));

    /// <summary>Every card row, held ones included, which is the only way to see what the sweep did.</summary>
    private static Task<IReadOnlyList<CardRow>> ShapeAsync(FlashcardStoreHarness h) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            var rows = new List<CardRow>();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Id, FactId, LayoutKey, TrashId FROM FlashcardCards ORDER BY Id;";
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new CardRow(
                    reader.GetString(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3)));
            }

            return (IReadOnlyList<CardRow>)rows;
        });

    private static Task<string?> TrashIdOfFactAsync(FlashcardStoreHarness h, string factId) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT TrashId FROM FlashcardFacts WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", factId);
            return await cmd.ExecuteScalarAsync(ct) as string;
        });

    private sealed record CardRow(string Id, string? FactId, string? LayoutKey, string? TrashId);
}
