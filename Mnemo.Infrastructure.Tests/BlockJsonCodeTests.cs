using System.Collections.Generic;
using System.Text.Json;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// The code block's display fields. The property under test is not that they
/// survive a round trip, it is that a block which never set them is written
/// exactly as it was before they existed.
/// </summary>
public class BlockJsonCodeTests
{
    private static Block CodeBlock(CodePayload payload) => new()
    {
        Id = "c1",
        Type = BlockType.Code,
        Order = 0,
        Spans = new List<InlineSpan> { InlineSpan.Plain(payload.Source) },
        Payload = payload,
        Meta = new Dictionary<string, object>()
    };

    [Fact]
    public void RoundTrip_Code_KeepsDisplayFields()
    {
        var options = new JsonSerializerOptions();
        var json = JsonSerializer.Serialize(
            CodeBlock(new CodePayload("python", "print(1)", Wrap: true, Numbers: true, Caption: "the loop")),
            options);

        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        var payload = Assert.IsType<CodePayload>(back.Payload);
        Assert.Equal("python", payload.Language);
        Assert.Equal("print(1)", payload.Source);
        Assert.True(payload.Wrap);
        Assert.True(payload.Numbers);
        Assert.Equal("the loop", payload.Caption);
    }

    [Fact]
    public void Serialize_Code_OmitsDisplayFieldsAtTheirDefaults()
    {
        var options = new JsonSerializerOptions();
        var json = JsonSerializer.Serialize(CodeBlock(new CodePayload("csharp", "var x = 1;")), options);

        Assert.DoesNotContain("\"wrap\"", json, StringComparison.Ordinal);
        Assert.DoesNotContain("\"numbers\"", json, StringComparison.Ordinal);
        Assert.DoesNotContain("\"caption\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void Deserialize_CodeWithoutDisplayFields_TakesTheDefaults()
    {
        var options = new JsonSerializerOptions();
        var json = """
            {"id":"a","type":"Code","order":0,"spans":[{"kind":"text","text":"var x = 1;","style":{}}],"payload":{"kind":"code","language":"csharp","source":"var x = 1;"},"meta":{}}
            """;

        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        var payload = Assert.IsType<CodePayload>(back.Payload);
        Assert.False(payload.Wrap);
        Assert.False(payload.Numbers);
        Assert.Equal(string.Empty, payload.Caption);
    }

    [Fact]
    public void Deserialize_CodeWithMistypedCaption_DoesNotThrow()
    {
        var options = new JsonSerializerOptions();
        var json = """
            {"id":"a","type":"Code","order":0,"payload":{"kind":"code","language":"csharp","source":"x","caption":42},"meta":{}}
            """;

        var back = JsonSerializer.Deserialize<Block>(json, options);

        Assert.NotNull(back);
        Assert.Equal(string.Empty, Assert.IsType<CodePayload>(back.Payload).Caption);
    }
}
