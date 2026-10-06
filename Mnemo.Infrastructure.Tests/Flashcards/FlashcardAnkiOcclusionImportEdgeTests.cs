using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;
using static Mnemo.Infrastructure.Tests.Flashcards.AnkiOcclusionImportKit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>History, comments, pictures and the notes that import as less than a full occlusion fact.</summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiOcclusionImportEdgeTests
{
    [Fact]
    public async Task Import_AnsweredGroup_KeepsItsScheduleAndHistoryOnTheGroupsCard()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-history.apkg", "History");

        var group = note.Doc.Masks.Where(m => m.Group is not null).ToArray();
        Assert.Equal(2, group.Length);
        var groupCard = note.Cards.Single(c => c.LayoutKey == "m" + group[0].Id);
        var otherCard = note.Cards.Single(c => c != groupCard);

        Assert.Single(await ReviewsAsync(h, groupCard.Id));
        Assert.Empty(await ReviewsAsync(h, otherCard.Id));
        Assert.Equal(1, CountOf(result, "AnkiReviewHistoryImported"));

        var studied = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, groupCard.Id, ct));
        var fresh = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, otherCard.Id, ct));
        Assert.True(studied!.Reps > 0);
        Assert.Equal(0, fresh!.Reps);
    }

    [Fact]
    public async Task Import_EdgeNotes_CountCommentsAndSkipTheNoteWithNoImage()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, cards) = await ImportAsync(h, "anki21b-image-occlusion-edge.apkg");
        var notes = await NotesAsync(h, cards);

        Assert.Equal(new[] { "Commented", "Kept" }, notes.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(4, cards.Length);
        Assert.Equal(4, CountOf(result, "AnkiOcclusionImported"));
        Assert.Equal(1, CountOf(result, "AnkiOcclusionImageMissing"));
        Assert.Equal(1, CountOf(result, "AnkiOcclusionCommentsLeftBehind"));
        Assert.Contains(result.Warnings, w => w.Key == "AnkiMediaNotFound" && w.Params["mediaName"] == "gone.png");

        var commented = notes["Commented"].Fact;
        Assert.Equal("Has comments", commented.Value(FlashcardCardType.OcclusionBackFieldId));
        Assert.DoesNotContain(
            cards, c => c.Back.Contains("Private study note", StringComparison.Ordinal));
        Assert.All(cards, c => Assert.Equal(FlashcardType.Occlusion, c.Type));

        Assert.True(result.Warnings.Single(w => w.Key == "AnkiOcclusionImageMissingMany").Severity == TransferWarningSeverity.Warning);
        Assert.All(
            result.Warnings.Where(w => w.Key.StartsWith("AnkiOcclusionImported", StringComparison.Ordinal)
                || w.Key.StartsWith("AnkiOcclusionCommentsLeftBehind", StringComparison.Ordinal)),
            w => Assert.Equal(TransferWarningSeverity.Info, w.Severity));
    }

    [Fact]
    public async Task Import_HeaderAndBackExtra_KeepTheirTextCountTheirPicturesAndDecodeLabelEntities()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-extras.apkg", "Heart");

        var back = note.Fact.Value(FlashcardCardType.OcclusionBackFieldId);
        Assert.Equal("Mitral valve\n\nFish & chips", back);
        Assert.Single(note.Fact.MediaOn(FlashcardCardType.OcclusionImageFieldId));
        Assert.Empty(note.Fact.MediaOn(FlashcardCardType.OcclusionBackFieldId));
        Assert.Empty(note.Fact.MediaOn(FlashcardCardType.OcclusionFrontFieldId));
        var skipped = result.Warnings.Single(w => w.Key == "AnkiOcclusionPicturesSkippedMany");
        Assert.Equal(1, skipped.Count);
        Assert.Equal(TransferWarningSeverity.Warning, skipped.Severity);
    }

    [Fact]
    public async Task Import_CardWithNoShapeLeft_IsCountedAndTheOthersKeepTheirOwn()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-extras.apkg", "Gap");

        Assert.Equal(2, note.Cards.Length);
        Assert.Equal(2, note.Doc.Masks.Count);
        Assert.Equal(1, CountOf(result, "AnkiOcclusionCardsWithoutShape"));
    }

    [Fact]
    public async Task Import_SuspendedCard_ArrivesSuspendedOnTheRightMask()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-extras.apkg", "Suspended");

        var first = note.Cards.Single(c => c.LayoutKey == "m" + note.Doc.Masks[0].Id);
        var second = note.Cards.Single(c => c.LayoutKey == "m" + note.Doc.Masks[1].Id);
        Assert.Equal(FlashcardCardState.Suspended, first.State);
        Assert.Equal(FlashcardCardState.Active, second.State);
    }

    [Fact]
    public async Task Import_ShapePastTheEdge_IsClampedToTheImage()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-extras.apkg", "Clamped");

        AssertBox(Assert.Single(note.Doc.Masks), 0.8, 0.8, 0.2, 0.2);
    }

    [Fact]
    public async Task Import_TwoNotesOverOnePicture_EachKeepsAnImageOfItsOwn()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, cards) = await ImportAsync(h, "anki21b-image-occlusion-extras.apkg");
        var notes = await NotesAsync(h, cards);

        var a = Assert.Single(notes["SharedA"].Fact.MediaOn(FlashcardCardType.OcclusionImageFieldId));
        var b = Assert.Single(notes["SharedB"].Fact.MediaOn(FlashcardCardType.OcclusionImageFieldId));
        Assert.True(File.Exists(a.FilePath));
        Assert.True(File.Exists(b.FilePath));
        Assert.NotEqual(a.FilePath, b.FilePath);
        Assert.Equal(2, notes["SharedA"].Cards.Length);
        Assert.Equal(2, notes["SharedB"].Cards.Length);
    }

    [Fact]
    public async Task Import_NoteWithNoShapeToMask_StaysPlainCards()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, cards) = await ImportAsync(h, "anki21b-image-occlusion-extras.apkg");

        var bare = Assert.Single(cards, c => c.Front.Contains("Bare", StringComparison.Ordinal));
        Assert.NotEqual(FlashcardType.Occlusion, bare.Type);
        Assert.DoesNotContain("not a shape", bare.Front, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Import_UnquotedImageSource_IsFound()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-extras.apkg", "Unquoted");

        Assert.Single(note.Fact.MediaOn(FlashcardCardType.OcclusionImageFieldId));
    }

    [Fact]
    public async Task Import_ShapeOnTwoAnsweredCards_GivesEachCardItsOwnHistory()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-multi-history.apkg", "MultiHistory");

        Assert.Equal(2, note.Cards.Length);
        Assert.Equal(2, note.Doc.Masks.Select(m => m.Id).Distinct().Count());
        foreach (var card in note.Cards)
        {
            Assert.Single(await ReviewsAsync(h, card.Id));
            var schedule = await h.Store.ReadAsync((conn, ct) => h.Schedules.GetAsync(conn, card.Id, ct));
            Assert.True(schedule!.Reps > 0);
        }
    }
}
