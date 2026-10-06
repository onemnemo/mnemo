using System;
using System.Linq;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

public sealed class AnkiOcclusionParserTests
{
    private const double Tolerance = 1e-9;

    [Fact]
    public void Parse_Rect_ReadsPositionAndSize()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c1::image-occlusion:rect:left=.1:top=.2325:width=.3:height=.0500:oi=1}}<br>"));

        Assert.Equal(AnkiShapeKind.Rect, shape.Kind);
        Assert.Equal(new[] { 1 }, shape.Ordinals);
        Assert.Equal(0.1, shape.Left, Tolerance);
        Assert.Equal(0.2325, shape.Top, Tolerance);
        Assert.Equal(0.3, shape.Width, Tolerance);
        Assert.Equal(0.05, shape.Height, Tolerance);
        Assert.True(shape.OccludeInactive);
        Assert.Equal(0, shape.Angle);
    }

    [Fact]
    public void Parse_LoneDot_IsZero()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c1::image-occlusion:rect:left=.:top=.3073:width=.0561:height=.1149:oi=1}}"));

        Assert.Equal(0, shape.Left, Tolerance);
        Assert.Equal(0.3073, shape.Top, Tolerance);
    }

    [Fact]
    public void Parse_Ellipse_TurnsRadiiIntoABox()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c2::image-occlusion:ellipse:left=.5:top=.5:rx=.1:ry=.15}}"));

        Assert.Equal(AnkiShapeKind.Ellipse, shape.Kind);
        Assert.Equal(0.5, shape.Left, Tolerance);
        Assert.Equal(0.2, shape.Width, Tolerance);
        Assert.Equal(0.3, shape.Height, Tolerance);
        Assert.False(shape.OccludeInactive);
    }

    [Fact]
    public void Parse_Polygon_ReadsPointsAndTheMovedPosition()
    {
        var plain = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c3::image-occlusion:polygon:left=.6:top=.1:points=.6,.1 .8,.1 .7,.3}}"));
        Assert.Equal(AnkiShapeKind.Polygon, plain.Kind);
        Assert.Equal(3, plain.Points.Count);
        Assert.Equal(new[] { 0.8, 0.1 }, plain.Points[1]);
        Assert.Equal(0.6, plain.Left, Tolerance);

        var moved = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c4::image-occlusion:polygon:left=.2:top=.6:points=.6,.1 .8,.1 .7,.3}}"));
        Assert.Equal(0.2, moved.Left, Tolerance);
        Assert.Equal(0.6, moved.Top, Tolerance);

        var unplaced = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c1::image-occlusion:polygon:points=.4,.5 .8,.5 .7,.9}}"));
        Assert.Equal(0.4, unplaced.Left, Tolerance);
        Assert.Equal(0.5, unplaced.Top, Tolerance);
    }

    [Fact]
    public void Parse_Text_UnescapesColonsAndBackslashes()
    {
        var shapes = AnkiOcclusionParser.Parse(
            @"{{c0::image-occlusion:text:left=.05:top=.9:text=Label\: one:scale=1:fs=.04:oi=1}}<br>"
            + @"{{c0::image-occlusion:text:left=.05:top=.02:text=Top\\note:scale=1:fs=.04}}");

        Assert.Equal(2, shapes.Count);
        Assert.All(shapes, s => Assert.Equal(AnkiShapeKind.Text, s.Kind));
        Assert.Equal(new[] { 0 }, shapes[0].Ordinals);
        Assert.Equal("Label: one", shapes[0].Text);
        Assert.Equal(@"Top\note", shapes[1].Text);
    }

    [Fact]
    public void Parse_TextEntities_AreDecoded()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c0::image-occlusion:text:left=.1:top=.1:text=A &amp; B&nbsp;&lt;1&gt;:scale=1}}"));

        Assert.Equal("A & B\u00A0<1>", shape.Text);
    }

    [Fact]
    public void Parse_ClosingBraces_EndTheShapeWhereAnkiEndsIt()
    {
        var shapes = AnkiOcclusionParser.Parse(
            "{{c0::image-occlusion:text:left=.1:top=.1:text=a}}b:scale=1}}"
            + "{{c1::image-occlusion:rect:left=.1:top=.1:width=.3:height=.3}}");

        Assert.Equal(2, shapes.Count);
        Assert.Equal("a", shapes[0].Text);
    }

    [Fact]
    public void Parse_SeveralOrdinals_NamesEachOnce()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c1,2,2::image-occlusion:rect:left=.1:top=.1:width=.3:height=.2}}"));

        Assert.Equal(new[] { 1, 2 }, shape.Ordinals);
    }

    [Fact]
    public void Parse_Angle_IsAFractionOfATurn()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c5::image-occlusion:rect:left=.7:top=.5:width=.2:height=.1:angle=2500}}"));

        Assert.Equal(0.25, shape.Angle, Tolerance);
    }

    [Fact]
    public void Parse_IgnoresStyleProperties()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c1::image-occlusion:rect:left=.1:top=.1:width=.3:height=.3:fill=#ffeba2:scale=2:fs=.05}}"));

        Assert.Equal(0.3, shape.Width, Tolerance);
    }

    [Fact]
    public void Parse_UnreadableShapes_AreSkippedButKeepTheirPlace()
    {
        var shapes = AnkiOcclusionParser.Parse(
            "{{c1::image-occlusion:rect:left=.1:top=.1:width=abc:height=.3}}"
            + "{{c1::image-occlusion:rect:left=.1:top=.1:width=0:height=.3}}"
            + "{{c1::image-occlusion:polygon:points=.1,.1 .2,.2}}"
            + "{{c1::image-occlusion:star:left=.1:top=.1}}"
            + "{{c1::image-occlusion:rect:left=.1:top=.1:width=.3:height=.3}}");

        var kept = Assert.Single(shapes);
        Assert.Equal(4, kept.Index);
    }

    [Fact]
    public void Parse_OrdinaryClozeAndJunk_GiveNothing()
    {
        Assert.Empty(AnkiOcclusionParser.Parse(null));
        Assert.Empty(AnkiOcclusionParser.Parse(string.Empty));
        Assert.Empty(AnkiOcclusionParser.Parse("{{c1::plain text}} and {{c2::more}}"));
        Assert.Empty(AnkiOcclusionParser.Parse("{{c1::image-occlusion:rect:left=.1:top=.1:width=.3:height=.3"));
    }

    [Fact]
    public void Parse_NumbersWithoutALeadingZero_AreRead()
    {
        var shape = Assert.Single(AnkiOcclusionParser.Parse(
            "{{c1::image-occlusion:rect:left=.0000:top=1:width=.9999:height=.5e-1}}"));

        Assert.Equal(0, shape.Left);
        Assert.Equal(1, shape.Top);
        Assert.Equal(0.9999, shape.Width, Tolerance);
        Assert.Equal(0.05, shape.Height, Tolerance);
    }
}
