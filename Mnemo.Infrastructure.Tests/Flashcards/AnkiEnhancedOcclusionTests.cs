using System.Collections.Generic;
using System.Linq;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>The SVG masks of the Image Occlusion Enhanced add-on, in the add-on's own form and in a re-saved, minified one.</summary>
public sealed class AnkiEnhancedOcclusionTests
{
    private const double Tolerance = 1e-6;

    private const string Original = """
        <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500">
         <g><title>Labels</title><text x="500" y="250">Aorta</text></g>
         <g>
          <title>Masks</title>
          <rect fill="#FFEBA2" x="100" y="50" width="200" height="100" id="9f1c-ao-1"/>
          <g id="9f1c-ao-2">
           <rect fill="#FFEBA2" x="400" y="100" width="100" height="50"/>
           <ellipse fill="#FFEBA2" cx="700" cy="300" rx="50" ry="25"/>
          </g>
         </g>
        </svg>
        """;

    private const string GroupQuestion = """
        <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500">
         <g><title>Masks</title>
          <rect fill="#FFEBA2" x="100" y="50" width="200" height="100" id="9f1c-ao-1"/>
          <g id="9f1c-ao-2" class="qshape">
           <rect fill="#FFEBA2" x="400" y="100" width="100" height="50"/>
           <ellipse fill="#FFEBA2" cx="700" cy="300" rx="50" ry="25"/>
          </g>
         </g>
        </svg>
        """;

    [Theory]
    [InlineData("372c3d3097c044dba09181e1726a724b-ao-3", "372c3d3097c044dba09181e1726a724b-ao", false, 3)]
    [InlineData(" 160310ebc9-oa-12 ", "160310ebc9-oa", true, 12)]
    public void ReadId_ReadsTheSetModeAndCard(string field, string set, bool hideOne, int ordinal)
    {
        Assert.Equal((set, hideOne, ordinal), AnkiEnhancedOcclusion.ReadId(field));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not an id")]
    [InlineData("9f1c-ao-0")]
    [InlineData("9f1c-xx-1")]
    public void ReadId_RefusesWhatIsNotAnAddOnId(string field)
    {
        Assert.Null(AnkiEnhancedOcclusion.ReadId(field));
    }

    [Fact]
    public void Layout_UsesTheAddOnsNames_AndRefusesAnUnrelatedType()
    {
        var named = new AnkiNoteType(
            1, "IOE", false, AnkiStockKind.Unknown,
            ["ID (hidden)", "Header", "Image", "Question Mask", "Footer", "Remarks", "Sources", "Extra 1", "Extra 2", "Answer Mask", "Original Mask"],
            []);
        var basic = new AnkiNoteType(2, "Basic", false, AnkiStockKind.Basic, ["Front", "Back"], []);

        var layout = AnkiEnhancedOcclusion.Layout(named, [new string[11]]);

        Assert.NotNull(layout);
        Assert.Equal((0, 2, 3, 10, (int?)1), (layout.Id, layout.Image, layout.QuestionMask, layout.OriginalMask, layout.Header));
        Assert.Equal(new[] { 4, 5, 6, 7, 8 }, layout.Back);
        Assert.Null(AnkiEnhancedOcclusion.Layout(basic, [["<img src=\"a-ao-1-Q.svg\">", "x"]]));
    }

    [Fact]
    public void Shapes_FindEachCardsShapesByTheQuestionClass_EvenWhenChildrenSetTheirOwnFill()
    {
        var shapes = AnkiEnhancedOcclusion.Shapes(
            new Dictionary<int, string?> { [2] = GroupQuestion }, Original, hideOne: false);

        var masks = shapes.Where(s => s.Kind != AnkiShapeKind.Text).ToArray();
        Assert.Equal(2, masks.Length);
        Assert.All(masks, s => Assert.Equal(new[] { 2 }, s.Ordinals));
        Assert.All(masks, s => Assert.True(s.OccludeInactive));

        var rect = Assert.Single(masks, s => s.Kind == AnkiShapeKind.Rect);
        AssertBox(rect, 0.4, 0.2, 0.1, 0.1);
        var ellipse = Assert.Single(masks, s => s.Kind == AnkiShapeKind.Ellipse);
        AssertBox(ellipse, 0.65, 0.55, 0.1, 0.1);
    }

    [Fact]
    public void Shapes_FallBackToTheOriginalMasksIdsWhenAQuestionMaskIsMissing()
    {
        var shape = Assert.Single(
            AnkiEnhancedOcclusion.Shapes(new Dictionary<int, string?> { [1] = null }, Original, hideOne: true),
            s => s.Kind != AnkiShapeKind.Text);

        Assert.Equal(new[] { 1 }, shape.Ordinals);
        Assert.False(shape.OccludeInactive);
        AssertBox(shape, 0.1, 0.1, 0.2, 0.2);
    }

    [Fact]
    public void Shapes_ReadAMinifiedQuestionMaskByItsColour()
    {
        const string question = """
            <svg height="500" width="1000" xmlns="http://www.w3.org/2000/svg"><g stroke="#2d2d2d"><path d="m100 50h200v100h-200z" fill="#ff7e7e"/><g fill="#ffeba2"><path d="m400 100h100v50h-100z"/></g></g></svg>
            """;

        var shape = Assert.Single(AnkiEnhancedOcclusion.Shapes(new Dictionary<int, string?> { [1] = question }, null, hideOne: false));

        Assert.Equal(AnkiShapeKind.Rect, shape.Kind);
        AssertBox(shape, 0.1, 0.1, 0.2, 0.2);
    }

    [Fact]
    public void Shapes_TurnARotatedRectangleIntoAPolygonWhereItIsDrawn()
    {
        const string question = """
            <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect class="qshape" x="40" y="40" width="20" height="20" transform="rotate(45 50 50)"/></svg>
            """;

        var shape = Assert.Single(AnkiEnhancedOcclusion.Shapes(new Dictionary<int, string?> { [1] = question }, null, hideOne: false));

        Assert.Equal(AnkiShapeKind.Polygon, shape.Kind);
        Assert.Equal(4, shape.Points.Count);
        var half = 10 * System.Math.Sqrt(2) / 100;
        Assert.Equal(0.5 - half, shape.Points.Min(p => p[0]), Tolerance);
        Assert.Equal(0.5 + half, shape.Points.Max(p => p[1]), Tolerance);
    }

    [Fact]
    public void Shapes_KeepLabelTextForTheBackAndIgnoreUnreadableSvg()
    {
        var label = Assert.Single(
            AnkiEnhancedOcclusion.Shapes(new Dictionary<int, string?> { [1] = "<svg not closed" }, Original, hideOne: false),
            s => s.Kind == AnkiShapeKind.Text);

        Assert.Equal("Aorta", label.Text);
        Assert.Empty(AnkiEnhancedOcclusion.Shapes(new Dictionary<int, string?> { [1] = "<html/>" }, "<svg/>", hideOne: false));
    }

    private static void AssertBox(AnkiOcclusionShape shape, double left, double top, double width, double height)
    {
        Assert.Equal(left, shape.Left, Tolerance);
        Assert.Equal(top, shape.Top, Tolerance);
        Assert.Equal(width, shape.Width, Tolerance);
        Assert.Equal(height, shape.Height, Tolerance);
    }
}
