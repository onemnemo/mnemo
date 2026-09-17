using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// A numeric field that arrives as a JSON string (a historic writer, an import, a hand edit) reads
/// as the field's default, the same way the web reader treats it. The block, and the note around
/// it, still load. Each case also goes back out and in again to show the fallback is stable.
/// </summary>
public class BlockJsonStringTypedNumberTests
{
    private static readonly JsonSerializerOptions Options = new();

    private static Block ReadAndRoundTrip(string json)
    {
        var first = JsonSerializer.Deserialize<Block>(json, Options);
        Assert.NotNull(first);
        var again = JsonSerializer.Deserialize<Block>(JsonSerializer.Serialize(first, Options), Options);
        Assert.NotNull(again);
        return again;
    }

    [Fact]
    public void Deserialize_StringOrder_FallsBackToZeroAndKeepsTheBlock()
    {
        var back = ReadAndRoundTrip(
            "{\"id\":\"a\",\"type\":\"Text\",\"order\":\"3\",\"spans\":[{\"kind\":\"text\",\"text\":\"kept\",\"style\":{}}]}");

        Assert.Equal(0, back.Order);
        Assert.Equal("kept", InlineSpanText.FlattenDisplay(back.Spans));
    }

    [Fact]
    public void Deserialize_StringImageWidth_FallsBackToZeroAndKeepsThePath()
    {
        var back = ReadAndRoundTrip(
            "{\"id\":\"a\",\"type\":\"Image\",\"order\":0,\"spans\":[],"
            + "\"payload\":{\"kind\":\"image\",\"path\":\"/p.png\",\"alt\":\"alt\",\"width\":\"320\",\"align\":\"center\"}}");

        var image = Assert.IsType<ImagePayload>(back.Payload);
        Assert.Equal(0, image.Width, precision: 9);
        Assert.Equal("/p.png", image.Path);
        Assert.Equal("center", image.Align);
    }

    [Fact]
    public void Deserialize_StringSplitRatio_FallsBackToHalf()
    {
        var back = ReadAndRoundTrip(
            "{\"id\":\"a\",\"type\":\"TwoColumn\",\"order\":0,\"spans\":[],\"payload\":{\"kind\":\"twoColumn\",\"splitRatio\":\"0.35\"}}");

        var split = Assert.IsType<TwoColumnPayload>(back.Payload);
        Assert.Equal(0.5, split.SplitRatio, precision: 9);
    }

    [Fact]
    public void Deserialize_StringSketchWidth_FallsBackToZeroAndKeepsTheAlign()
    {
        var back = ReadAndRoundTrip(
            "{\"id\":\"a\",\"type\":\"Sketch\",\"order\":0,\"spans\":[],\"payload\":{\"kind\":\"sketch\",\"width\":\"200\",\"align\":\"right\"}}");

        var sketch = Assert.IsType<SketchPayload>(back.Payload);
        Assert.Equal(0, sketch.Width, precision: 9);
        Assert.Equal("right", sketch.Align);
    }

    [Fact]
    public void Deserialize_StringFractionParts_FallBackAndKeepTheNeighbouringSpan()
    {
        var back = ReadAndRoundTrip(
            "{\"id\":\"a\",\"type\":\"Text\",\"order\":0,\"spans\":["
            + "{\"kind\":\"fraction\",\"numerator\":\"1\",\"denominator\":\"2\",\"style\":{}},"
            + "{\"kind\":\"text\",\"text\":\"after\",\"style\":{}}]}");

        var fraction = Assert.IsType<FractionSpan>(back.Spans[0]);
        Assert.Equal(0, fraction.Numerator);
        Assert.Equal(1, fraction.Denominator);
        Assert.Equal("after", Assert.IsType<TextSpan>(back.Spans[1]).Text);
    }

    [Fact]
    public void Deserialize_LegacyMetaStringImageWidth_FallsBackToZero()
    {
        var back = ReadAndRoundTrip(
            "{\"id\":\"a\",\"type\":\"Image\",\"order\":0,\"spans\":[],"
            + "\"meta\":{\"imagePath\":\"/p.png\",\"imageAlt\":\"alt\",\"imageWidth\":\"100\",\"imageAlign\":\"right\"}}");

        var image = Assert.IsType<ImagePayload>(back.Payload);
        Assert.Equal(0, image.Width, precision: 9);
        Assert.Equal("/p.png", image.Path);
        Assert.Equal("right", image.Align);
    }

    [Fact]
    public void Deserialize_LegacyMetaStringSplitRatio_FallsBackToHalf()
    {
        var back = ReadAndRoundTrip(
            "{\"id\":\"a\",\"type\":\"TwoColumn\",\"order\":0,\"spans\":[],\"meta\":{\"columnSplitRatio\":\"0.3\"}}");

        var split = Assert.IsType<TwoColumnPayload>(back.Payload);
        Assert.Equal(0.5, split.SplitRatio, precision: 9);
    }

    [Fact]
    public void Deserialize_OneStringTypedField_DoesNotFailTheOtherBlocksInTheNote()
    {
        var json = "["
            + "{\"id\":\"a\",\"type\":\"Image\",\"order\":0,\"spans\":[],\"payload\":{\"kind\":\"image\",\"path\":\"/p.png\",\"alt\":\"\",\"width\":\"320\",\"align\":\"left\"}},"
            + "{\"id\":\"b\",\"type\":\"Text\",\"order\":1,\"spans\":[{\"kind\":\"text\",\"text\":\"second\",\"style\":{}}]}"
            + "]";

        var blocks = JsonSerializer.Deserialize<List<Block>>(json, Options);

        Assert.NotNull(blocks);
        Assert.Equal(2, blocks.Count);
        Assert.Equal("a", blocks[0].Id);
        Assert.Equal("second", InlineSpanText.FlattenDisplay(blocks[1].Spans));
    }
}
