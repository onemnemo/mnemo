using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Which attachment files get queued for deletion when whatever named them - a card, a piece of
/// material, a deck - is deleted or edited to drop it.
/// </summary>
/// <remarks>
/// The recurring hazard here is aliasing: a card made from material carries the very same
/// <see cref="FlashcardAttachment.FilePath"/> its material stored the picture under, and every
/// other card the same material makes can carry it too. Deleting one of those cards must never
/// queue the file its material or a sibling card still shows; only deleting the material itself,
/// or dropping the picture from the material's own edit, may do that.
///
/// Queueing is as far as any of this goes. The file itself is only removed once a sweep confirms
/// nothing at all still names it, held rows included, which is what keeps a picture alive while a
/// card that uses it is sitting in the trash.
/// </remarks>
public sealed class FlashcardAttachmentCleanupTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Deleting_a_legacy_card_with_no_material_queues_its_attachment_file()
    {
        // Every card made through the normal routes gets material of its own (FlashcardCardMaterial
        // wraps even a hand typed front/back), so a card with no FactId only exists as data an
        // upgrade has not reached yet. It still owns its file outright and must still lose it.
        await using var h = await OpenAsync();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var path = ManagedPath("front.png");
        var card = new Flashcard(
            Id: Guid.NewGuid().ToString("N"), DeckId: "deck-1", Type: FlashcardType.Classic,
            Front: "Q", Back: "A", Tags: [], State: FlashcardCardState.Active, IsFlagged: false,
            Attachments: [Attachment("a1", path)], CreatedAt: Now, UpdatedAt: Now);
        await h.Store.WriteAsync((conn, tx, ct) => h.Cards.InsertAsync(conn, tx, card, ct));

        await cardSvc.DeleteCardsAsync([card.Id]);

        Assert.Contains(path, await QueuedAsync(h));
    }

    [Fact]
    public async Task Deleting_the_only_card_of_its_material_removes_the_orphaned_material_and_queues_its_file()
    {
        // A fact with no card left is invisible and unreachable: nothing lists it, nothing can
        // edit it, and it would otherwise sit in the database forever holding its file down.
        await using var h = await OpenAsync();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var path = ManagedPath("shared.png");
        var saved = await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q",
            ["back"] = "A",
        }, media: MediaOn("front", "a1", path)));
        var card = saved.Cards.Single();

        await cardSvc.DeleteCardsAsync([card.Id]);

        Assert.Contains(path, await QueuedAsync(h));
        Assert.Null(await factSvc.GetFactAsync(saved.Fact.Id));
    }

    [Fact]
    public async Task Deleting_one_sibling_card_leaves_the_file_the_other_sibling_still_needs()
    {
        // A cloze deletion with two markers makes two cards off one fact; deleting one is not
        // deleting the material, so the file the surviving sibling still shows must stay.
        await using var h = await OpenAsync();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var path = ManagedPath("shared.png");
        var saved = await factSvc.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::A}} and {{c2::B}}",
        }, media: MediaOn("text", "a1", path)));
        Assert.Equal(2, saved.Cards.Count);

        await cardSvc.DeleteCardsAsync([saved.Cards[0].Id]);

        Assert.Empty(await QueuedAsync(h));
        Assert.NotNull(await factSvc.GetFactAsync(saved.Fact.Id));

        await cardSvc.DeleteCardsAsync([saved.Cards[1].Id]);

        Assert.Contains(path, await QueuedAsync(h));
        Assert.Null(await factSvc.GetFactAsync(saved.Fact.Id));
    }

    [Fact]
    public async Task Deleting_material_queues_its_media_files()
    {
        await using var h = await OpenAsync();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock);

        var path = ManagedPath("front.png");
        var saved = await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q",
            ["back"] = "A",
        }, media: MediaOn("front", "a1", path)));

        await factSvc.DeleteFactsAsync([saved.Fact.Id]);

        Assert.Contains(path, await QueuedAsync(h));
        Assert.Null(await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, saved.Cards.Single().Id, ct)));
    }

    [Fact]
    public async Task Saving_material_again_queues_the_dropped_attachment_and_keeps_the_one_still_there()
    {
        await using var h = await OpenAsync();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock);

        var kept = ManagedPath("kept.png");
        var dropped = ManagedPath("dropped.png");
        var first = await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q",
            ["back"] = "A",
        }, media: new Dictionary<string, IReadOnlyList<FlashcardAttachment>>
        {
            ["front"] = [Attachment("a1", kept), Attachment("a2", dropped)],
        }));

        await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q",
            ["back"] = "A",
        }, id: first.Fact.Id, media: MediaOn("front", "a1", kept)));

        var queued = await QueuedAsync(h);
        Assert.Contains(dropped, queued);
        Assert.DoesNotContain(kept, queued);
    }

    [Fact]
    public async Task Deleting_a_deck_queues_freeform_card_files_and_files_of_material_left_with_no_cards_anywhere()
    {
        await using var h = await OpenAsync();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock);
        var lib = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

        var freeformPath = ManagedPath("freeform.png");
        await cardSvc.CreateCardAsync(new FlashcardCardDraft(
            "deck-1", FlashcardType.Classic, "Q", "A", [], [Attachment("f1", freeformPath)]));

        var materialPath = ManagedPath("material.png");
        await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q2",
            ["back"] = "A2",
        }, media: MediaOn("front", "m1", materialPath)));

        var deleted = await lib.DeleteDeckAsync("deck-1");

        Assert.True(deleted);
        var queued = await QueuedAsync(h);
        Assert.Contains(freeformPath, queued);
        Assert.Contains(materialPath, queued);
    }

    [Fact]
    public async Task Deleting_a_deck_keeps_material_and_its_file_when_one_of_its_cards_was_moved_elsewhere_first()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock);
        var lib = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

        var path = ManagedPath("still-used.png");
        var saved = await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q",
            ["back"] = "A",
        }, media: MediaOn("front", "m1", path)));
        var card = saved.Cards.Single();

        // The card moves out to another deck; its material's home is still deck-1.
        await cardSvc.MoveCardsAsync([card.Id], "deck-2");
        var movedCard = await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, card.Id, ct));
        Assert.Equal("deck-2", movedCard!.DeckId);

        var deleted = await lib.DeleteDeckAsync("deck-1");

        Assert.True(deleted);
        Assert.DoesNotContain(path, await QueuedAsync(h));
        Assert.NotNull(await factSvc.GetFactAsync(saved.Fact.Id));
        Assert.NotNull(await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, card.Id, ct)));
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

    /// <summary>
    /// The paths waiting in the cleanup queue. Nothing enqueued yet means no table yet, which reads
    /// the same as an empty queue.
    /// </summary>
    private static Task<List<string>> QueuedAsync(FlashcardStoreHarness harness) =>
        harness.Store.ReadAsync(async (conn, ct) =>
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

    private static string ManagedPath(string name) =>
        Path.Combine(MnemoAppPaths.GetImagesDirectory(), $"{Guid.NewGuid():N}-{name}");

    private static FlashcardAttachment Attachment(string id, string path) =>
        new(id, FlashcardAttachment.FrontSide, path, Path.GetFileName(path), 100);

    private static IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> MediaOn(string fieldId, string attachmentId, string path) =>
        new Dictionary<string, IReadOnlyList<FlashcardAttachment>> { [fieldId] = [Attachment(attachmentId, path)] };

    private static FlashcardFactDraft Draft(
        string typeId,
        Dictionary<string, string> values,
        string? id = null,
        string deckId = "deck-1",
        IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>>? media = null) =>
        new(id, deckId, typeId, values, media ?? new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(), []);
}
