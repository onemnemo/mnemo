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

/// <summary>Packages written by Anki itself with occlusion notes, found by their header since note ids change.</summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiOcclusionImportTests
{
    [Fact]
    public async Task Import_Shapes_KeepsEveryShapeAtItsCoordinates()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-shapes.apkg", "Shapes");

        Assert.Equal(5, note.Cards.Length);
        Assert.Equal(FlashcardOcclusion.HideAll, note.Doc.Mode);
        Assert.Equal(5, note.Doc.Masks.Count);
        Assert.Equal(new[] { 0, 1, 2, 3, 4 }, note.Doc.Masks.Select(m => m.Order));

        var rect = note.Doc.Masks[0];
        Assert.Equal(FlashcardOcclusion.Rect, rect.Shape);
        AssertBox(rect, 0.1, 0.1, 0.3, 0.3);

        var ellipse = note.Doc.Masks[1];
        Assert.Equal(FlashcardOcclusion.Ellipse, ellipse.Shape);
        AssertBox(ellipse, 0.5, 0.5, 0.2, 0.2);

        var polygon = note.Doc.Masks[2];
        Assert.Equal(FlashcardOcclusion.Polygon, polygon.Shape);
        AssertBox(polygon, 0.6, 0.1, 0.2, 0.2);
        AssertPoints(polygon, (0.6, 0.1), (0.8, 0.1), (0.7, 0.3));

        var moved = note.Doc.Masks[3];
        AssertBox(moved, 0.2, 0.6, 0.2, 0.2);
        AssertPoints(moved, (0.2, 0.6), (0.4, 0.6), (0.3, 0.8));

        var rotated = note.Doc.Masks[4];
        Assert.Equal(FlashcardOcclusion.Rect, rotated.Shape);
        AssertBox(rotated, 0.7, 0.5, 0.2, 0.1);

        Assert.Equal(1, CountOf(result, "AnkiOcclusionRotated"));
        Assert.Equal(5, CountOf(result, "AnkiOcclusionImported"));
        Assert.All(note.Doc.Masks, m => Assert.Null(m.Group));
    }

    [Fact]
    public async Task Import_Shapes_MovesTextLabelsToBackInReadingOrder()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-shapes.apkg", "Shapes");

        Assert.Equal("Shapes", note.Fact.Value(FlashcardCardType.OcclusionFrontFieldId));
        Assert.Equal("Shape notes\n\nTop\\note\n\nLabel: one", note.Fact.Value(FlashcardCardType.OcclusionBackFieldId));
        Assert.Equal(2, CountOf(result, "AnkiOcclusionTextToBack"));
        Assert.DoesNotContain("image-occlusion", note.Fact.Value(FlashcardCardType.OcclusionMasksFieldId), StringComparison.Ordinal);
        Assert.Single(note.Fact.MediaOn(FlashcardCardType.OcclusionImageFieldId));
    }

    [Fact]
    public async Task Import_Grouped_MakesOneCardPerOrdinalWithGroupsKeyedByTheirFirstMember()
    {
        await using var h = new FlashcardStoreHarness();
        var (result, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-grouped.apkg", "Group");

        Assert.Equal(2, note.Cards.Length);
        Assert.Equal(3, note.Doc.Masks.Count);
        var members = note.Doc.Masks.Where(m => m.Group is not null).ToArray();
        Assert.Equal(2, members.Length);
        Assert.All(members, m => Assert.Equal(members[0].Id, m.Group));
        AssertBox(members[0], 0.1, 0.1, 0.2, 0.2);
        AssertBox(members[1], 0.6, 0.1, 0.2, 0.2);

        var single = note.Doc.Masks.Single(m => m.Group is null);
        Assert.Equal(FlashcardOcclusion.Ellipse, single.Shape);
        AssertBox(single, 0.3, 0.5, 0.3, 0.2);
        Assert.Equal(
            new[] { "m" + members[0].Id, "m" + single.Id }.Order(StringComparer.Ordinal),
            note.Cards.Select(c => c.LayoutKey!).Order(StringComparer.Ordinal));
        Assert.Equal(5, CountOf(result, "AnkiOcclusionImported"));
    }

    [Fact]
    public async Task Import_MultiOrdinalShape_BecomesOneMaskPerOrdinal()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, note) = await ImportNoteAsync(h, "anki21b-image-occlusion-grouped.apkg", "Multi");

        Assert.Equal(3, note.Cards.Length);
        Assert.Equal(3, note.Doc.Masks.Count);
        Assert.Equal(3, note.Doc.Masks.Select(m => m.Id).Distinct().Count());
        Assert.All(note.Doc.Masks, m => Assert.Null(m.Group));
        AssertBox(note.Doc.Masks[0], 0.1, 0.1, 0.3, 0.2);
        AssertBox(note.Doc.Masks[1], 0.1, 0.1, 0.3, 0.2);
        AssertBox(note.Doc.Masks[2], 0.5, 0.6, 0.3, 0.2);
        Assert.Equal(
            note.Doc.Masks.Select(m => "m" + m.Id).Order(StringComparer.Ordinal),
            note.Cards.Select(c => c.LayoutKey!).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Import_WithoutOccludeInactive_IsHideOneAndAnyMarkedShapeMakesItHideAll()
    {
        await using var h = new FlashcardStoreHarness();
        var (_, hideOne) = await ImportNoteAsync(h, "anki21b-image-occlusion-hide-one.apkg", "Hide one");
        Assert.Equal(FlashcardOcclusion.HideOne, hideOne.Doc.Mode);
        Assert.Equal(2, hideOne.Cards.Length);

        await using var second = new FlashcardStoreHarness();
        var (_, mixed) = await ImportNoteAsync(second, "anki21b-image-occlusion-hide-one.apkg", "Mixed");
        Assert.Equal(FlashcardOcclusion.HideAll, mixed.Doc.Mode);
    }

    [Fact]
    public async Task Import_SamePackageAgain_GivesTheSameMaskIdsAndCardKeys()
    {
        await using var first = new FlashcardStoreHarness();
        var (_, one) = await ImportNoteAsync(first, "anki21b-image-occlusion-shapes.apkg", "Shapes");
        await using var second = new FlashcardStoreHarness();
        var (_, two) = await ImportNoteAsync(second, "anki21b-image-occlusion-shapes.apkg", "Shapes");

        Assert.Equal(one.Doc.Masks.Select(m => m.Id), two.Doc.Masks.Select(m => m.Id));
        Assert.Equal(
            one.Cards.Select(c => c.LayoutKey!).Order(StringComparer.Ordinal),
            two.Cards.Select(c => c.LayoutKey!).Order(StringComparer.Ordinal));
    }
}
