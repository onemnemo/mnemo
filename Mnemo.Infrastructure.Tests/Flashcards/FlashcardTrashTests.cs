using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// The flashcard collection's side of the trash: what a held row is invisible to, what it survives,
/// what a deck or a piece of material takes with it, and where each of them comes back to.
/// </summary>
public sealed class FlashcardTrashTests
{
    private static readonly DateTimeOffset Now = new(2026, 4, 1, 8, 0, 0, TimeSpan.Zero);

    // ---- Decks -------------------------------------------------------------------------------

    [Fact]
    public async Task A_held_deck_leaves_the_library_without_leaving_the_database()
    {
        await using var h = await OpenAsync();
        var decks = Sources(h).Decks;

        var snapshot = await decks.CaptureAsync("deck-1", "e1");

        Assert.NotNull(snapshot);
        Assert.Equal("Deck", snapshot!.Title);
        Assert.Null(await Library(h).GetDeckAsync("deck-1"));
        Assert.Empty(await Library(h).ListDecksAsync());
        Assert.True(await decks.HoldsAsync("e1"));
    }

    [Fact]
    public async Task A_held_deck_takes_its_cards_and_their_schedules_out_of_the_collection()
    {
        await using var h = await OpenAsync();
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var cardId = saved.Cards.Single().Id;

        await Sources(h).Decks.CaptureAsync("deck-1", "e1");

        Assert.Null(await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct)));
        Assert.NotNull(await ScheduleOfAsync(h, cardId));
    }

    [Fact]
    public async Task Restoring_a_deck_brings_its_cards_back_exactly_where_they_were()
    {
        await using var h = await OpenAsync();
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var cardId = saved.Cards.Single().Id;
        var decks = Sources(h).Decks;

        await decks.CaptureAsync("deck-1", "e1");
        var restore = await decks.RestoreAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        var card = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct));
        Assert.NotNull(card);
        Assert.Equal("deck-1", card!.DeckId);
        Assert.NotNull(await h.FactService.GetFactAsync(saved.Fact.Id));
    }

    [Fact]
    public async Task Material_whose_card_lives_in_another_deck_stays_behind_and_is_refiled_there()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var cardId = saved.Cards.Single().Id;
        await Cards(h).MoveCardsAsync([cardId], "deck-2");

        await Sources(h).Decks.CaptureAsync("deck-1", "e1");

        // The material's home deck is gone, so it is refiled under the deck its surviving card is in
        // rather than left pointing at something nobody can see.
        var fact = await h.FactService.GetFactAsync(saved.Fact.Id);
        Assert.NotNull(fact);
        Assert.Equal("deck-2", fact!.DeckId);
        Assert.NotNull(await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct)));
    }

    [Fact]
    public async Task Restoring_the_deck_puts_refiled_material_back_where_it_was()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var saved = await SaveMaterialAsync(h, "Q", "A");
        await Cards(h).MoveCardsAsync([saved.Cards.Single().Id], "deck-2");
        var decks = Sources(h).Decks;

        await decks.CaptureAsync("deck-1", "e1");
        await decks.RestoreAsync("e1");

        var fact = await h.FactService.GetFactAsync(saved.Fact.Id);
        Assert.Equal("deck-1", fact!.DeckId);
    }

    [Fact]
    public async Task A_refile_somebody_made_in_the_meantime_survives_the_restore()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        await h.SeedDeckAsync("deck-3");
        var saved = await SaveMaterialAsync(h, "Q", "A");
        await Cards(h).MoveCardsAsync([saved.Cards.Single().Id], "deck-2");
        var decks = Sources(h).Decks;

        await decks.CaptureAsync("deck-1", "e1");

        // Somebody files the material somewhere else while the deck is in the trash. That is a
        // decision made after the delete, so undoing the delete must not undo it too.
        await h.FactService.SaveFactAsync(Draft(
            FlashcardCardType.BasicId,
            new() { ["front"] = "Q", ["back"] = "A" },
            id: saved.Fact.Id,
            deckId: "deck-3"));

        await decks.RestoreAsync("e1");

        var fact = await h.FactService.GetFactAsync(saved.Fact.Id);
        Assert.Equal("deck-3", fact!.DeckId);
    }

    [Fact]
    public async Task Purging_a_deck_destroys_its_cards_and_queues_their_files()
    {
        await using var h = await OpenAsync();
        var path = ManagedPath("purged.png");
        var saved = await SaveMaterialAsync(h, "Q", "A", path);
        var cardId = saved.Cards.Single().Id;
        var decks = Sources(h).Decks;

        await decks.CaptureAsync("deck-1", "e1");
        var purge = await decks.PurgeAsync("e1");

        Assert.True(purge.Completed);
        Assert.Equal(0, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardCards WHERE Id = $p;", cardId));
        Assert.Equal(0, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardDecks WHERE Id = $p;", "deck-1"));
        Assert.Contains(path, await QueuedAsync(h));
    }

    [Fact]
    public async Task Purging_a_deck_waits_for_a_card_of_its_own_another_entry_is_holding()
    {
        await using var h = await OpenAsync();
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var sources = Sources(h);

        // The card is deleted on its own first, then the whole deck. Destroying the deck now would
        // take the card with it and leave the card's entry offering a restore of nothing.
        await sources.Cards.CaptureAsync(saved.Cards.Single().Id, "card-entry");
        await sources.Decks.CaptureAsync("deck-1", "deck-entry");

        var purge = await sources.Decks.PurgeAsync("deck-entry");

        Assert.False(purge.Completed);
        Assert.Equal("card-entry", Assert.Single(purge.BlockingEntryIds));
    }

    [Fact]
    public async Task A_held_deck_takes_material_whose_only_card_had_been_moved_into_it()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var saved = await SaveMaterialAsync(h, "Q", "A");
        await Cards(h).MoveCardsAsync([saved.Cards.Single().Id], "deck-2");

        await Sources(h).Decks.CaptureAsync("deck-2", "e1");

        // The material is filed under deck-1 and has never been near deck-2, but the only card it
        // makes went in there and has just been taken. There is nothing left of it to show.
        Assert.Null(await h.FactService.GetFactAsync(saved.Fact.Id));
    }

    [Fact]
    public async Task Restoring_the_deck_gives_back_material_it_took_that_way()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var cardId = saved.Cards.Single().Id;
        await Cards(h).MoveCardsAsync([cardId], "deck-2");
        var decks = Sources(h).Decks;

        await decks.CaptureAsync("deck-2", "e1");
        Assert.Equal(TrashRestoreOutcome.Restored, (await decks.RestoreAsync("e1")).Outcome);

        var fact = await h.FactService.GetFactAsync(saved.Fact.Id);
        Assert.NotNull(fact);
        Assert.Equal("deck-1", fact!.DeckId);
        var card = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct));
        Assert.Equal("deck-2", card!.DeckId);
    }

    [Fact]
    public async Task Purging_a_deck_destroys_material_whose_only_card_had_been_moved_into_it()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var path = ManagedPath("moved-in.png");
        var saved = await SaveMaterialAsync(h, "Q", "A", path);
        await Cards(h).MoveCardsAsync([saved.Cards.Single().Id], "deck-2");
        var decks = Sources(h).Decks;

        await decks.CaptureAsync("deck-2", "e1");
        Assert.True((await decks.PurgeAsync("e1")).Completed);

        Assert.Equal(0, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardFacts WHERE Id = $p;", saved.Fact.Id));
        Assert.Contains(path, await QueuedAsync(h));
    }

    // ---- Deck folders ------------------------------------------------------------------------

    [Fact]
    public async Task A_held_folder_takes_its_subtree_and_gives_it_back()
    {
        await using var h = await OpenAsync();
        await SeedFolderAsync(h, "f1", null);
        await SeedFolderAsync(h, "f2", "f1");
        await MoveDeckAsync(h, "deck-1", "f2");
        var folders = Sources(h).Folders;

        var snapshot = await folders.CaptureAsync("f1", "e1");

        Assert.NotNull(snapshot);
        Assert.Equal(1, snapshot!.ContainedCount);
        Assert.Empty(await Library(h).ListFoldersAsync());
        Assert.Empty(await Library(h).ListDecksAsync());

        var restore = await folders.RestoreAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        Assert.Equal(2, (await Library(h).ListFoldersAsync()).Count);
        var deck = Assert.Single(await Library(h).ListDecksAsync());
        Assert.Equal("f2", deck.Header.FolderId);
    }

    [Fact]
    public async Task A_folder_entry_and_a_deck_entry_are_told_apart_by_what_each_one_holds()
    {
        await using var h = await OpenAsync();
        await SeedFolderAsync(h, "f1", null);
        await MoveDeckAsync(h, "deck-1", "f1");
        var sources = Sources(h);

        await sources.Folders.CaptureAsync("f1", "folder-entry");

        // Both stamp deck rows, so only the folder table tells the two kinds apart.
        Assert.True(await sources.Folders.HoldsAsync("folder-entry"));
        Assert.False(await sources.Decks.HoldsAsync("folder-entry"));
        Assert.Contains("folder-entry", await sources.Folders.HeldEntryIdsAsync());
        Assert.DoesNotContain("folder-entry", await sources.Decks.HeldEntryIdsAsync());
    }

    // ---- Cards -------------------------------------------------------------------------------

    [Fact]
    public async Task A_held_card_keeps_its_layout_so_a_save_in_the_meantime_makes_no_second_one()
    {
        await using var h = await OpenAsync();
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var cardId = saved.Cards.Single().Id;
        var cards = Sources(h).Cards;

        await cards.CaptureAsync(cardId, "e1");

        // Saving the material again must not fill the layout the held card still occupies, or the
        // restore would put two cards in one slot.
        await h.FactService.SaveFactAsync(Draft(
            FlashcardCardType.BasicId,
            new() { ["front"] = "Q edited", ["back"] = "A" },
            id: saved.Fact.Id));

        Assert.Equal(1, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardCards WHERE FactId = $p;", saved.Fact.Id));

        var restore = await cards.RestoreAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        var card = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct));
        Assert.NotNull(card);

        // The card comes back with the wording it had when it was deleted; the next save catches it up.
        Assert.Equal("Q", card!.Front);
    }

    [Fact]
    public async Task A_card_whose_deck_is_in_the_trash_too_waits_for_the_deck()
    {
        await using var h = await OpenAsync();
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var sources = Sources(h);

        await sources.Cards.CaptureAsync(saved.Cards.Single().Id, "card-entry");
        await sources.Decks.CaptureAsync("deck-1", "deck-entry");

        var restore = await sources.Cards.RestoreAsync("card-entry");

        Assert.Equal(TrashRestoreOutcome.BlockedByContainer, restore.Outcome);
    }

    [Fact]
    public async Task A_card_comes_back_into_the_deck_the_user_picks_rather_than_the_one_it_left()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var card = FlashcardStoreHarness.Card("c1", "deck-1", "Q", "A");
        await h.AddCardAsync(card, FlashcardSchedule.NewFor(card.Id, Now));
        var cards = Sources(h).Cards;

        await cards.CaptureAsync("c1", "e1");
        var restore = await cards.RestoreAsync("e1", new TrashRestoreTarget("deck-2"));

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        Assert.Equal("deck-2", restore.DestinationId);
        var back = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, "c1", ct));
        Assert.Equal("deck-2", back!.DeckId);
    }

    [Fact]
    public async Task Material_whose_deck_is_no_longer_there_asks_for_somewhere_to_go()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var facts = Sources(h).Facts;

        await facts.CaptureAsync(saved.Fact.Id, "e1");

        // Material records the deck it is filed under without a foreign key holding the two together,
        // so a deck that went away before the trash existed leaves it pointing at nothing.
        await DestroyDeckRowAsync(h, "deck-1");

        Assert.Equal(TrashRestoreOutcome.DestinationRequired, (await facts.RestoreAsync("e1")).Outcome);

        var restore = await facts.RestoreAsync("e1", new TrashRestoreTarget("deck-2"));

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        Assert.Equal("deck-2", restore.DestinationId);
        var fact = await h.FactService.GetFactAsync(saved.Fact.Id);
        Assert.Equal("deck-2", fact!.DeckId);
    }

    [Fact]
    public async Task Purging_the_last_card_of_a_piece_of_material_takes_the_material_too()
    {
        await using var h = await OpenAsync();
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var cards = Sources(h).Cards;

        await cards.CaptureAsync(saved.Cards.Single().Id, "e1");
        await cards.PurgeAsync("e1");

        Assert.Equal(0, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardFacts WHERE Id = $p;", saved.Fact.Id));
    }

    // ---- Material ----------------------------------------------------------------------------

    [Fact]
    public async Task Deleting_material_takes_a_card_somebody_filed_into_another_deck()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var saved = await SaveMaterialAsync(h, "{{c1::A}} and {{c2::B}}", null, typeId: FlashcardCardType.ClozeId);
        Assert.Equal(2, saved.Cards.Count);
        await Cards(h).MoveCardsAsync([saved.Cards[0].Id], "deck-2");
        var facts = Sources(h).Facts;

        var snapshot = await facts.CaptureAsync(saved.Fact.Id, "e1");

        Assert.NotNull(snapshot);
        Assert.Equal(2, snapshot!.ContainedCount);
        var page = await Cards(h).ListCardsAsync(new FlashcardCardQuery("deck-2"));
        Assert.Empty(page.Items);

        await facts.RestoreAsync("e1");

        var back = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, saved.Cards[0].Id, ct));
        Assert.Equal("deck-2", back!.DeckId);
    }

    // ---- Cascades from an outright delete -----------------------------------------------------

    [Fact]
    public async Task Deleting_a_folder_outright_lifts_a_held_folder_inside_it_to_the_root()
    {
        await using var h = await OpenAsync();
        await SeedFolderAsync(h, "parent", null);
        await SeedFolderAsync(h, "child", "parent");
        await Sources(h).Folders.CaptureAsync("child", "e1");

        Assert.True(await Library(h).DeleteFolderAsync("parent"));

        // The held folder is still there to restore, and no longer points at a folder that is gone.
        Assert.Equal(1, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardFolders WHERE Id = $p;", "child"));
        Assert.Equal(0, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardFolders WHERE Id = $p AND ParentId IS NOT NULL;", "child"));
        Assert.Equal(TrashRestoreOutcome.Restored, (await Sources(h).Folders.RestoreAsync("e1")).Outcome);
    }

    [Fact]
    public async Task Deleting_material_outright_leaves_a_held_card_of_it_as_a_freeform_card()
    {
        await using var h = await OpenAsync();
        var saved = await SaveMaterialAsync(h, "{{c1::A}} and {{c2::B}}", null, typeId: FlashcardCardType.ClozeId);
        var held = saved.Cards[0].Id;
        await Sources(h).Cards.CaptureAsync(held, "e1");

        await h.FactService.DeleteFactsAsync([saved.Fact.Id]);

        await Sources(h).Cards.RestoreAsync("e1");
        var card = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, held, ct));
        Assert.NotNull(card);
        Assert.Null(card!.FactId);
        Assert.Equal("deck-1", card.DeckId);
    }

    [Fact]
    public async Task Deleting_a_deck_outright_destroys_the_held_cards_in_it_and_queues_their_files()
    {
        await using var h = await OpenAsync();
        var path = ManagedPath("lost.png");
        var card = FlashcardStoreHarness.Card("c1", "deck-1", "Q", "A") with
        {
            Attachments = [Attachment("a1", path)],
        };
        await h.AddCardAsync(card, FlashcardSchedule.NewFor(card.Id, Now));
        await Sources(h).Cards.CaptureAsync("c1", "e1");

        Assert.True(await Library(h).DeleteDeckAsync("deck-1"));

        // A card has to have a deck, so this one cannot be saved. Its file is accounted for and the
        // entry is left holding nothing, which reconciliation drops.
        Assert.Equal(0, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardCards WHERE Id = $p;", "c1"));
        Assert.Contains(path, await QueuedAsync(h));
        Assert.False(await Sources(h).Cards.HoldsAsync("e1"));
    }

    [Fact]
    public async Task A_deck_the_trash_is_holding_cannot_be_deleted_outright()
    {
        await using var h = await OpenAsync();
        await Sources(h).Decks.CaptureAsync("deck-1", "e1");

        Assert.False(await Library(h).DeleteDeckAsync("deck-1"));
        Assert.Equal(1, await CountAsync(h, "SELECT COUNT(*) FROM FlashcardDecks WHERE Id = $p;", "deck-1"));
    }

    // ---- Writing into something the trash is holding ------------------------------------------

    [Fact]
    public async Task Cards_cannot_be_moved_into_a_deck_the_trash_is_holding()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var saved = await SaveMaterialAsync(h, "Q", "A");
        var cardId = saved.Cards.Single().Id;
        await Sources(h).Decks.CaptureAsync("deck-2", "e1");

        await Cards(h).MoveCardsAsync([cardId], "deck-2");

        var card = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, cardId, ct));
        Assert.Equal("deck-1", card!.DeckId);
    }

    [Fact]
    public async Task A_deck_saved_under_a_folder_the_trash_is_holding_lands_at_the_root()
    {
        await using var h = await OpenAsync();
        await SeedFolderAsync(h, "f1", null);
        await Sources(h).Folders.CaptureAsync("f1", "e1");

        await Library(h).MoveDeckAsync("deck-1", "f1", 0);

        var deck = await Library(h).GetDeckAsync("deck-1");
        Assert.Null(deck!.Header.FolderId);
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    private readonly record struct TrashSources(
        FlashcardDeckFolderTrashSource Folders,
        FlashcardDeckTrashSource Decks,
        FlashcardFactTrashSource Facts,
        FlashcardCardTrashSource Cards);

    private static TrashSources Sources(FlashcardStoreHarness h) => new(
        new FlashcardDeckFolderTrashSource(h.Store),
        new FlashcardDeckTrashSource(h.Store),
        new FlashcardFactTrashSource(h.Store),
        new FlashcardCardTrashSource(h.Store));

    private static FlashcardLibraryService Library(FlashcardStoreHarness h) => new(
        h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    private static FlashcardCardService Cards(FlashcardStoreHarness h) =>
        new(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    private static Task<FlashcardFactSaved> SaveMaterialAsync(
        FlashcardStoreHarness h,
        string front,
        string? back,
        string? mediaPath = null,
        string typeId = FlashcardCardType.BasicId)
    {
        var values = typeId == FlashcardCardType.ClozeId
            ? new Dictionary<string, string> { ["text"] = front }
            : new Dictionary<string, string> { ["front"] = front, ["back"] = back ?? string.Empty };
        var field = typeId == FlashcardCardType.ClozeId ? "text" : "front";
        var media = mediaPath is null
            ? null
            : new Dictionary<string, IReadOnlyList<FlashcardAttachment>> { [field] = [Attachment("m1", mediaPath)] };
        return h.FactService.SaveFactAsync(Draft(typeId, values, media: media));
    }

    private static FlashcardFactDraft Draft(
        string typeId,
        Dictionary<string, string> values,
        string? id = null,
        string deckId = "deck-1",
        IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>>? media = null) =>
        new(id, deckId, typeId, values, media ?? new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(), []);

    private static FlashcardAttachment Attachment(string id, string path) =>
        new(id, FlashcardAttachment.FrontSide, path, System.IO.Path.GetFileName(path), 100);

    private static string ManagedPath(string name) =>
        System.IO.Path.Combine(MnemoAppPaths.GetImagesDirectory(), $"{Guid.NewGuid():N}-{name}");

    private static Task SeedFolderAsync(FlashcardStoreHarness h, string id, string? parentId) =>
        h.Store.WriteAsync((conn, tx, ct) =>
            h.Folders.UpsertAsync(conn, tx, new FlashcardFolder(id, id, parentId, 0), Now, ct));

    private static Task MoveDeckAsync(FlashcardStoreHarness h, string deckId, string? folderId) =>
        h.Store.WriteAsync((conn, tx, ct) => h.Decks.MoveAsync(conn, tx, deckId, folderId, 0, Now, ct));

    /// <summary>Removes a deck row outright, standing in for a delete made before the trash existed.</summary>
    private static Task DestroyDeckRowAsync(FlashcardStoreHarness h, string deckId) =>
        h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM FlashcardDecks WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", deckId);
            await cmd.ExecuteNonQueryAsync(ct);
        });

    private static Task<FlashcardSchedule?> ScheduleOfAsync(FlashcardStoreHarness h, string cardId) =>
        h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, cardId, ct));

    private static Task<int> CountAsync(FlashcardStoreHarness h, string sql, string parameter) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("$p", parameter);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
        });

    private static Task<List<string>> QueuedAsync(FlashcardStoreHarness h) =>
        h.Store.ReadAsync(async (conn, ct) =>
        {
            var paths = new List<string>();

            await using var exists = conn.CreateCommand();
            exists.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'AssetCleanupJobs';";
            if (await exists.ExecuteScalarAsync(ct) is null)
                return paths;

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Path FROM AssetCleanupJobs WHERE Owner = $owner;";
            cmd.Parameters.AddWithValue("$owner", FlashcardAssetReferences.AssetOwner);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                paths.Add(reader.GetString(0));

            return paths;
        });
}
