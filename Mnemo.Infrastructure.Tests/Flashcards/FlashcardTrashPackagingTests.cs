using System.Threading.Tasks;
using Mnemo.Core.Models;
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

    // ---- Plumbing ----------------------------------------------------------------------------

    private static FlashcardsMnemoPayloadHandler Handler(FlashcardStoreHarness h)
    {
        var logger = new TestLogger();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var presets = new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock);
        return new FlashcardsMnemoPayloadHandler(library, cards, presets, h.Store, h.Schedules, logger);
    }

    private static MnemoPayloadExportContext ExportContext() =>
        new() { Options = new MnemoPackageExportOptions() };

    private static MnemoPayloadImportContext ImportContext(MnemoPayloadExportData exported) => new()
    {
        Entry = new MnemoPackageEntry
        {
            PayloadType = "flashcards",
            ItemCount = exported.ItemCount,
            SchemaVersion = exported.SchemaVersion,
            Path = "payloads/flashcards",
        },
        Options = new MnemoPackageImportOptions(),
        Files = exported.Files,
    };

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
}
