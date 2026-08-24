using System.Text.Json;
using Mnemo.Host.Chrome;
using Photino.NET;
using Xunit;

namespace Mnemo.Host.Tests.Chrome;

public sealed class DragRegionPayloadTests
{
    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    [Fact]
    public void TranslatesRectanglesIntoTopLeftAnchoredRegions()
    {
        var payload = Parse("""{"drag":[{"x":0,"y":0,"w":800,"h":48}],"noDrag":[{"x":750,"y":10,"w":40,"h":28}]}""");

        Assert.True(DragRegionPayload.TryParse(payload, out var drag, out var noDrag));

        var strip = Assert.Single(drag);
        Assert.Equal(800, strip.Width);
        Assert.Equal(48, strip.Height);
        Assert.Equal(0, strip.Margin.Left);
        Assert.Equal(0, strip.Margin.Top);
        Assert.Equal(HorizontalAlignment.Left, strip.HorizontalAlignment);
        Assert.Equal(VerticalAlignment.Top, strip.VerticalAlignment);

        var control = Assert.Single(noDrag);
        Assert.Equal(40, control.Width);
        Assert.Equal(28, control.Height);
        Assert.Equal(750, control.Margin.Left);
        Assert.Equal(10, control.Margin.Top);
    }

    [Fact]
    public void EmptyListsAreAValidClearingPayload()
    {
        var payload = Parse("""{"drag":[],"noDrag":[]}""");

        Assert.True(DragRegionPayload.TryParse(payload, out var drag, out var noDrag));

        Assert.Empty(drag);
        Assert.Empty(noDrag);
    }

    [Fact]
    public void SkipsAZeroSizeRectangleWithoutRefusingTheRest()
    {
        var payload = Parse("""{"drag":[{"x":0,"y":0,"w":0,"h":48},{"x":0,"y":0,"w":640,"h":48}],"noDrag":[]}""");

        Assert.True(DragRegionPayload.TryParse(payload, out var drag, out _));

        Assert.Equal(640, Assert.Single(drag).Width);
    }

    [Fact]
    public void SnapsANegativeOriginToTheEdge()
    {
        var payload = Parse("""{"drag":[{"x":-1,"y":-2,"w":100,"h":40}],"noDrag":[]}""");

        Assert.True(DragRegionPayload.TryParse(payload, out var drag, out _));

        var region = Assert.Single(drag);
        Assert.Equal(0, region.Margin.Left);
        Assert.Equal(0, region.Margin.Top);
    }

    [Theory]
    [InlineData("""{"drag":[{"x":0,"y":0,"w":-5,"h":40}],"noDrag":[]}""")]
    [InlineData("""{"drag":[{"x":0,"y":0,"w":100}],"noDrag":[]}""")]
    [InlineData("""{"drag":[{"x":"0","y":0,"w":100,"h":40}],"noDrag":[]}""")]
    [InlineData("""{"drag":[42],"noDrag":[]}""")]
    [InlineData("""{"drag":{},"noDrag":[]}""")]
    [InlineData("""{"drag":[]}""")]
    [InlineData("42")]
    public void RefusesAMalformedPayloadAsAWhole(string json)
    {
        var payload = Parse(json);

        Assert.False(DragRegionPayload.TryParse(payload, out var drag, out var noDrag));

        Assert.Empty(drag);
        Assert.Empty(noDrag);
    }

    [Fact]
    public void CapsEachListAtItsBound()
    {
        var rectangles = string.Join(",", Enumerable.Range(0, 200)
            .Select(i => $$"""{"x":{{i}},"y":0,"w":10,"h":10}"""));
        var payload = Parse($$"""{"drag":[{{rectangles}}],"noDrag":[]}""");

        Assert.True(DragRegionPayload.TryParse(payload, out var drag, out _));

        Assert.Equal(128, drag.Count);
        Assert.Equal(0, drag[0].Margin.Left);
        Assert.Equal(127, drag[^1].Margin.Left);
    }
}
