using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests;

public class BlockJsonImageTests
{
    [Fact]
    public void RoundTrip_Image_PayloadFieldsAndMetaKeysStripped()
    {
        var options = new JsonSerializerOptions();
        var block = new Block
        {
            Id = "img1",
            Type = BlockType.Image,
            Order = 0,
            Spans = new List<InlineSpan> { InlineSpan.Plain("caption") },
            Payload = new ImagePayload("/x/photo.png", "caption", 320, "center"),
            Meta = new Dictionary<string, object>
            {
                ["imagePath"] = "should-not-round-trip",
                ["imageAlt"] = "legacy",
                ["imageWidth"] = 1.0,
                ["imageAlign"] = "right",
                ["custom"] = "keep"
            }
        };

        var json = JsonSerializer.Serialize(block, options);
        Assert.DoesNotContain("imagePath", json, StringComparison.Ordinal);
        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        Assert.Equal(BlockType.Image, back.Type);
        var p = Assert.IsType<ImagePayload>(back.Payload);
        Assert.Equal("/x/photo.png", p.Path);
        Assert.Equal(320, p.Width, precision: 5);
        Assert.Equal("center", p.Align);
        Assert.False(back.Meta.ContainsKey("imagePath"));
        Assert.True(back.Meta.TryGetValue("custom", out var c) && c?.ToString() == "keep");
    }

    [Fact]
    public void RoundTrip_Image_CarriesTheCropWindow()
    {
        var options = new JsonSerializerOptions();
        var block = new Block
        {
            Id = "img2",
            Type = BlockType.Image,
            Spans = new List<InlineSpan> { InlineSpan.Plain("cropped") },
            Payload = new ImagePayload("/x/photo.png", "cropped", 420, "center", new ImageCrop(0.125, 0.25, 0.5, 0.375, 1.5))
        };

        var json = JsonSerializer.Serialize(block, options);
        Assert.Contains("\"crop\":{\"x\":0.125,\"y\":0.25,\"w\":0.5,\"h\":0.375,\"aspect\":1.5}", json, StringComparison.Ordinal);

        var back = JsonSerializer.Deserialize<Block>(json, options);
        Assert.NotNull(back);
        var crop = Assert.IsType<ImagePayload>(back.Payload).Crop;
        Assert.NotNull(crop);
        Assert.Equal(0.125, crop.X, precision: 9);
        Assert.Equal(0.25, crop.Y, precision: 9);
        Assert.Equal(0.5, crop.W, precision: 9);
        Assert.Equal(0.375, crop.H, precision: 9);
        Assert.Equal(1.5, crop.Aspect, precision: 9);
    }

    /// <summary>
    /// The whole reason crop is written only when set: an image saved before crops existed has to
    /// come back out as the bytes it went in as, or every note holding one changes on first open.
    /// </summary>
    [Fact]
    public void Serialize_ImageWithoutCrop_IsByteIdenticalToThePreCropShape()
    {
        var block = new Block
        {
            Id = "img3",
            Type = BlockType.Image,
            Order = 2,
            Spans = new List<InlineSpan> { InlineSpan.Plain("caption") },
            Payload = new ImagePayload("/x/photo.png", "caption", 320, "center")
        };

        var json = JsonSerializer.Serialize(block, new JsonSerializerOptions());

        Assert.Equal(
            "{\"id\":\"img3\",\"type\":\"Image\",\"order\":2,"
            + "\"spans\":[{\"kind\":\"text\",\"text\":\"caption\",\"style\":{\"bold\":false,\"italic\":false,"
            + "\"underline\":false,\"strikethrough\":false,\"code\":false,\"highlight\":false,\"suppressAutoLink\":false}}],"
            + "\"payload\":{\"kind\":\"image\",\"path\":\"/x/photo.png\",\"alt\":\"caption\",\"width\":320,\"align\":\"center\"},"
            + "\"meta\":{}}",
            json);
    }

    [Theory]
    // Absent, not an object, and every way one of the five numbers can be unusable. All of them
    // read as no crop, and none of them stops the block from loading.
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\"}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":null}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":\"0.1,0.1,0.5,0.5,1\"}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":0.1,\"y\":0.1,\"w\":0.5,\"h\":0.5}}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":0.1,\"y\":0.1,\"w\":0.5,\"h\":0.5,\"aspect\":0}}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":0.1,\"y\":0.1,\"w\":0.5,\"h\":0.5,\"aspect\":\"wide\"}}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":1.4,\"y\":0.1,\"w\":0.5,\"h\":0.5,\"aspect\":1}}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":-0.1,\"y\":0.1,\"w\":0.5,\"h\":0.5,\"aspect\":1}}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":0.1,\"y\":0.1,\"w\":0,\"h\":0.5,\"aspect\":1}}")]
    // Below the 1e-6 floor but still a positive number: too small to compile through the Typst
    // ratio math, so it reads as no crop the same way an outright zero does.
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":0.1,\"y\":0.1,\"w\":0.0000001,\"h\":0.5,\"aspect\":1}}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":0.1,\"y\":0.1,\"w\":0.5,\"h\":0.0000001,\"aspect\":1}}")]
    [InlineData("{\"kind\":\"image\",\"path\":\"/p.png\",\"crop\":{\"x\":0.1,\"y\":0.1,\"w\":0.5,\"h\":0.5,\"aspect\":0.0000001}}")]
    public void Deserialize_UnusableCrop_ReadsAsNoCropAndKeepsTheBlock(string payload)
    {
        var json = $"{{\"id\":\"a\",\"type\":\"Image\",\"order\":0,\"spans\":[],\"payload\":{payload}}}";

        var back = JsonSerializer.Deserialize<Block>(json, new JsonSerializerOptions());

        Assert.NotNull(back);
        var image = Assert.IsType<ImagePayload>(back.Payload);
        Assert.Equal("/p.png", image.Path);
        Assert.Null(image.Crop);
    }

    [Fact]
    public void Deserialize_CropPropertyNames_MatchCaseInsensitively()
    {
        // Everything else in a block does, and the crop is read through the same lookup.
        var json = "{\"id\":\"a\",\"type\":\"Image\",\"order\":0,\"spans\":[],\"payload\":"
            + "{\"kind\":\"image\",\"path\":\"/p.png\",\"Crop\":{\"X\":0.2,\"Y\":0.3,\"W\":0.4,\"H\":0.5,\"Aspect\":0.8}}}";

        var back = JsonSerializer.Deserialize<Block>(json, new JsonSerializerOptions());

        Assert.NotNull(back);
        var crop = Assert.IsType<ImagePayload>(back.Payload).Crop;
        Assert.NotNull(crop);
        Assert.Equal(0.2, crop.X, precision: 9);
        Assert.Equal(0.8, crop.Aspect, precision: 9);
    }

    [Fact]
    public void Deserialize_LegacyMetaOnly_BuildsImagePayload()
    {
        var options = new JsonSerializerOptions();
        var json = """
            {"id":"a","type":"Image","order":0,"spans":[{"kind":"text","text":"alt","style":{}}],"meta":{"imagePath":"/p.png","imageAlt":"alt","imageWidth":100,"imageAlign":"right"}}
            """;
        var back = JsonSerializer.Deserialize<Block>(json, options);
        Assert.NotNull(back);
        var p = Assert.IsType<ImagePayload>(back.Payload);
        Assert.Equal("/p.png", p.Path);
        Assert.Equal(100, p.Width, precision: 5);
        Assert.Equal("right", p.Align);
    }
}
