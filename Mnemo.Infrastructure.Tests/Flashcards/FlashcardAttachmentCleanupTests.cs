using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// What happens to an attachment's file on disk when whatever named it - a card, a piece of
/// material, a deck - is deleted or edited to drop it.
/// </summary>
/// <remarks>
/// The recurring hazard here is aliasing: a card made from material carries the very same
/// <see cref="FlashcardAttachment.FilePath"/> its material stored the picture under, and every
/// other card the same material makes can carry it too. Deleting one of those cards must never
/// take the file out from under its material or a sibling card; only deleting the material
/// itself, or dropping the picture from the material's own edit, may do that.
/// </remarks>
public sealed class FlashcardAttachmentCleanupTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task DeletingALegacyCardWithNoMaterial_DeletesItsAttachmentFile()
    {
        // Every card made through the normal routes gets material of its own (FlashcardCardMaterial
        // wraps even a hand typed front/back), so a card with no FactId only exists as data an
        // upgrade has not reached yet. It still owns its file outright and must still lose it.
        await using var h = await OpenAsync();
        var images = new RecordingImageAssetService();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock, images);

        var path = ManagedPath("front.png");
        var card = new Flashcard(
            Id: Guid.NewGuid().ToString("N"), DeckId: "deck-1", Type: FlashcardType.Classic,
            Front: "Q", Back: "A", Tags: [], State: FlashcardCardState.Active, IsFlagged: false,
            Attachments: [Attachment("a1", path)], CreatedAt: Now, UpdatedAt: Now);
        await h.Store.WriteAsync((conn, tx, ct) => h.Cards.InsertAsync(conn, tx, card, ct));

        await cardSvc.DeleteCardsAsync([card.Id]);

        Assert.Contains(path, images.Deleted);
    }

    [Fact]
    public async Task DeletingTheOnlyCardOfItsMaterial_DeletesTheOrphanedMaterialAndItsFile()
    {
        // A fact with no card left is invisible and unreachable: nothing lists it, nothing can
        // edit it, and it would otherwise sit in the database forever holding its file down.
        await using var h = await OpenAsync();
        var images = new RecordingImageAssetService();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock, images);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock, images);

        var path = ManagedPath("shared.png");
        var saved = await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q",
            ["back"] = "A",
        }, media: MediaOn("front", "a1", path)));
        var card = saved.Cards.Single();

        await cardSvc.DeleteCardsAsync([card.Id]);

        Assert.Contains(path, images.Deleted);
        Assert.Null(await factSvc.GetFactAsync(saved.Fact.Id));
    }

    [Fact]
    public async Task DeletingOneSiblingCard_LeavesTheFileTheOtherSiblingStillNeeds()
    {
        // A cloze deletion with two markers makes two cards off one fact; deleting one is not
        // deleting the material, so the file the surviving sibling still shows must stay.
        await using var h = await OpenAsync();
        var images = new RecordingImageAssetService();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock, images);
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock, images);

        var path = ManagedPath("shared.png");
        var saved = await factSvc.SaveFactAsync(Draft(FlashcardCardType.ClozeId, new()
        {
            ["text"] = "{{c1::A}} and {{c2::B}}",
        }, media: MediaOn("text", "a1", path)));
        Assert.Equal(2, saved.Cards.Count);

        await cardSvc.DeleteCardsAsync([saved.Cards[0].Id]);

        Assert.Empty(images.Deleted);
        Assert.NotNull(await factSvc.GetFactAsync(saved.Fact.Id));

        await cardSvc.DeleteCardsAsync([saved.Cards[1].Id]);

        Assert.Contains(path, images.Deleted);
        Assert.Null(await factSvc.GetFactAsync(saved.Fact.Id));
    }

    [Fact]
    public async Task DeletingMaterial_DeletesItsMediaFiles()
    {
        await using var h = await OpenAsync();
        var images = new RecordingImageAssetService();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock, images);

        var path = ManagedPath("front.png");
        var saved = await factSvc.SaveFactAsync(Draft(FlashcardCardType.BasicId, new()
        {
            ["front"] = "Q",
            ["back"] = "A",
        }, media: MediaOn("front", "a1", path)));

        await factSvc.DeleteFactsAsync([saved.Fact.Id]);

        Assert.Contains(path, images.Deleted);
        Assert.Null(await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, saved.Cards.Single().Id, ct)));
    }

    [Fact]
    public async Task SavingMaterialAgain_DeletesTheDroppedAttachment_KeepsTheOneStillThere()
    {
        await using var h = await OpenAsync();
        var images = new RecordingImageAssetService();
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock, images);

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

        Assert.Contains(dropped, images.Deleted);
        Assert.DoesNotContain(kept, images.Deleted);
    }

    [Fact]
    public async Task DeletingADeck_DeletesFreeformCardFiles_AndFilesOfMaterialLeftWithNoCardsAnywhere()
    {
        await using var h = await OpenAsync();
        var images = new RecordingImageAssetService();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock, images);
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock, images);
        var lib = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock, images);

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
        Assert.Contains(freeformPath, images.Deleted);
        Assert.Contains(materialPath, images.Deleted);
    }

    [Fact]
    public async Task DeletingADeck_KeepsMaterialAndItsFile_WhenOneOfItsCardsWasMovedElsewhereFirst()
    {
        await using var h = await OpenAsync();
        await h.SeedDeckAsync("deck-2");
        var images = new RecordingImageAssetService();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock, images);
        var factSvc = new FlashcardFactService(h.Store, h.Facts, h.CardTypes, h.Cards, h.Materializer, h.Clock, images);
        var lib = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock, images);

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
        Assert.DoesNotContain(path, images.Deleted);
        Assert.NotNull(await factSvc.GetFactAsync(saved.Fact.Id));
        Assert.NotNull(await h.Store.ReadAsync((conn, ct) => h.Cards.GetAsync(conn, card.Id, ct)));
    }

    [Fact]
    public async Task AnAttachmentOutsideTheManagedDirectory_IsNeverDeleted()
    {
        await using var h = await OpenAsync();
        var images = new RecordingImageAssetService();
        var cardSvc = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock, images);

        // An imported card can point at a file the user still has elsewhere on disk.
        var external = Path.Combine(Path.GetTempPath(), "mnemo-external-test", "photo.png");
        var card = await cardSvc.CreateCardAsync(new FlashcardCardDraft(
            "deck-1", FlashcardType.Classic, "Q", "A", [], [Attachment("e1", external)]));

        await cardSvc.DeleteCardsAsync([card.Id]);

        Assert.Empty(images.Deleted);
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    private static async Task<FlashcardStoreHarness> OpenAsync()
    {
        var harness = new FlashcardStoreHarness(Now);
        await harness.SeedDeckAsync();
        return harness;
    }

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

    private sealed class RecordingImageAssetService : IImageAssetService
    {
        public List<string> Deleted { get; } = new();

        public Task<Result<string>> ImportAndCopyAsync(string sourcePath, string blockId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by these tests.");

        public Task<Result> DeleteStoredFileAsync(string absolutePath, CancellationToken cancellationToken = default)
        {
            Deleted.Add(absolutePath);
            return Task.FromResult(Result.Success());
        }
    }
}
