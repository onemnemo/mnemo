using System;
using System.Linq;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

public sealed class AnkiOcclusionMapperTests
{
    private const double Tolerance = 1e-4;

    private static AnkiOcclusionMapped Map(string field, long noteId = 100) =>
        AnkiOcclusionMapper.Map(noteId, AnkiOcclusionParser.Parse(field))!;

    private static OcclusionDocument Doc(AnkiOcclusionMapped mapped) => FlashcardOcclusion.Parse(mapped.MasksJson);

    private const string RectC1 = "{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2:oi=1}}";
    private const string RectC1Right = "{{c1::image-occlusion:rect:left=.6:top=.1:width=.2:height=.2:oi=1}}";
    private const string EllipseC2 = "{{c2::image-occlusion:ellipse:left=.3:top=.5:rx=.15:ry=.1:oi=1}}";

    [Fact]
    public void Map_Ids_AreStableAndDistinctPerShapeAndOrdinal()
    {
        var field = RectC1 + "{{c1,2::image-occlusion:rect:left=.5:top=.5:width=.1:height=.1}}";
        var first = Doc(Map(field));
        var again = Doc(Map(field));
        var other = Doc(Map(field, noteId: 101));

        Assert.Equal(first.Masks.Select(m => m.Id), again.Masks.Select(m => m.Id));
        Assert.Equal(3, first.Masks.Select(m => m.Id).Distinct().Count());
        Assert.All(first.Masks, m => Assert.True(m.Id.Length >= 8 && FlashcardOcclusion.IsValidId(m.Id)));
        Assert.Empty(first.Masks.Select(m => m.Id).Intersect(other.Masks.Select(m => m.Id)));
    }

    [Fact]
    public void Map_ShapesSharingAnOrdinal_BecomeAGroupLabelledByTheFirstMember()
    {
        var mapped = Map(RectC1 + RectC1Right + EllipseC2);
        var doc = Doc(mapped);

        var members = doc.Masks.Where(m => m.Group is not null).ToArray();
        Assert.Equal(2, members.Length);
        Assert.All(members, m => Assert.Equal(members[0].Id, m.Group));
        Assert.Null(doc.Masks.Single(m => m.Shape == FlashcardOcclusion.Ellipse).Group);

        Assert.Equal(
            new[] { "m" + members[0].Id, "m" + doc.Masks.Single(m => m.Shape == FlashcardOcclusion.Ellipse).Id },
            mapped.OrdinalByKey.OrderBy(p => p.Value).Select(p => p.Key));
        Assert.Equal(new[] { 1, 2 }, mapped.OrdinalByKey.Values.Order());
    }

    [Fact]
    public void Map_SeveralOrdinals_BecomeOneMaskEach()
    {
        var mapped = Map("{{c1,2::image-occlusion:rect:left=.1:top=.1:width=.3:height=.2}}");
        var doc = Doc(mapped);

        Assert.Equal(2, doc.Masks.Count);
        Assert.All(doc.Masks, m => Assert.Null(m.Group));
        Assert.Equal(2, mapped.OrdinalByKey.Count);
        Assert.Equal(new[] { 1, 2 }, mapped.OrdinalByKey.Values.Order());
    }

    [Fact]
    public void Map_Order_FollowsOrdinalThenShapePosition()
    {
        var doc = Doc(Map(EllipseC2 + RectC1Right + RectC1));

        Assert.Equal(new[] { 0, 1, 2 }, doc.Masks.Select(m => m.Order));
        Assert.Equal(
            new[] { FlashcardOcclusion.Rect, FlashcardOcclusion.Rect, FlashcardOcclusion.Ellipse },
            doc.Masks.Select(m => m.Shape));
        Assert.Equal(0.6, doc.Masks[0].X, Tolerance);
    }

    [Fact]
    public void Map_Ellipse_KeepsItsBox()
    {
        var mask = Assert.Single(Doc(Map(EllipseC2)).Masks);

        Assert.Equal(FlashcardOcclusion.Ellipse, mask.Shape);
        Assert.Equal(0.3, mask.X, Tolerance);
        Assert.Equal(0.5, mask.Y, Tolerance);
        Assert.Equal(0.3, mask.W, Tolerance);
        Assert.Equal(0.2, mask.H, Tolerance);
    }

    [Fact]
    public void Map_MovedPolygon_IsDrawnWhereTheBoxWent()
    {
        var mask = Assert.Single(Doc(Map(
            "{{c4::image-occlusion:polygon:left=.2:top=.6:points=.6,.1 .8,.1 .7,.3}}")).Masks);

        Assert.Equal(0.2, mask.X, Tolerance);
        Assert.Equal(0.6, mask.Y, Tolerance);
        Assert.Equal(0.2, mask.W, Tolerance);
        Assert.Equal(0.2, mask.H, Tolerance);
        Assert.Equal(new[] { 0.2, 0.6 }, mask.Points![0].Select(R));
        Assert.Equal(new[] { 0.4, 0.6 }, mask.Points[1].Select(R));
        Assert.Equal(new[] { 0.3, 0.8 }, mask.Points[2].Select(R));
    }

    [Fact]
    public void Map_AnyOccludeInactiveShape_MeansHideAll()
    {
        Assert.Equal(FlashcardOcclusion.HideAll, Doc(Map(RectC1 + EllipseC2)).Mode);
        Assert.Equal(
            FlashcardOcclusion.HideAll,
            Doc(Map(RectC1 + "{{c2::image-occlusion:rect:left=.5:top=.5:width=.1:height=.1}}")).Mode);
        Assert.Equal(
            FlashcardOcclusion.HideOne,
            Doc(Map("{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}")).Mode);
    }

    [Fact]
    public void Map_TextShapes_AreLabelsInReadingOrderAndNeverMasks()
    {
        var mapped = Map(
            RectC1
            + "{{c0::image-occlusion:text:left=.05:top=.9:text=Low:scale=1}}"
            + "{{c0::image-occlusion:text:left=.5:top=.02:text=Right:scale=1}}"
            + "{{c0::image-occlusion:text:left=.1:top=.02:text=Left:scale=1}}"
            + "{{c3::image-occlusion:text:left=.1:top=.5:text=Numbered:scale=1}}"
            + "{{c0::image-occlusion:text:left=.1:top=.3:text=:scale=1}}");

        Assert.Equal(new[] { "Left", "Right", "Numbered", "Low" }, mapped.TextLabels);
        Assert.Single(Doc(mapped).Masks);
        Assert.Single(mapped.OrdinalByKey);
    }

    [Fact]
    public void Map_RotatedShapes_AreCountedAndKeepTheirStoredBox()
    {
        var mapped = Map(
            "{{c1::image-occlusion:rect:left=.7:top=.5:width=.2:height=.1:angle=2500}}"
            + "{{c2::image-occlusion:ellipse:left=.1:top=.1:rx=.1:ry=.1:angle=500}}"
            + "{{c3::image-occlusion:polygon:left=.1:top=.1:points=.1,.1 .2,.1 .2,.2:angle=900}}"
            + "{{c4::image-occlusion:rect:left=.1:top=.1:width=.1:height=.1}}");

        Assert.Equal(2, mapped.RotatedShapes);
        Assert.Equal(
            2,
            Map("{{c1,2::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2:angle=2500}}").RotatedShapes);
        var rect = Doc(mapped).Masks[0];
        Assert.Equal(0.7, rect.X, Tolerance);
        Assert.Equal(0.2, rect.W, Tolerance);
        Assert.Equal(0.1, rect.H, Tolerance);
    }

    [Fact]
    public void Map_OrdinalZeroBoxes_MakeNoMask()
    {
        var mapped = Map(RectC1 + "{{c0::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}");

        Assert.Single(Doc(mapped).Masks);
    }

    [Fact]
    public void Map_NothingToAsk_GivesNull()
    {
        Assert.Null(AnkiOcclusionMapper.Map(1, AnkiOcclusionParser.Parse(string.Empty)));
        Assert.Null(AnkiOcclusionMapper.Map(1, AnkiOcclusionParser.Parse(
            "{{c0::image-occlusion:text:left=.1:top=.1:text=Only a label:scale=1}}")));
        Assert.Null(AnkiOcclusionMapper.Map(1, AnkiOcclusionParser.Parse(
            "{{c0::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}")));
    }

    [Fact]
    public void Map_ShapePastTheEdge_IsClampedToTheImage()
    {
        var mask = Assert.Single(Doc(Map("{{c1::image-occlusion:rect:left=.9:top=.9:width=.5:height=.5}}")).Masks);

        Assert.Equal(0.1, mask.W, Tolerance);
        Assert.Equal(0.1, mask.H, Tolerance);
    }

    private static double R(double value) => Math.Round(value, 4);
}
