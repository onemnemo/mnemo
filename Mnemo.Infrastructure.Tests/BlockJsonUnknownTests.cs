using System.Text.Json;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Notes travel between versions: a file written by a newer build gets opened by an older one, and
/// a note saved on one machine syncs to another. A block this build cannot read has to survive that
/// round trip, because the alternative is that opening a note quietly deletes part of it.
/// </summary>
public class BlockJsonUnknownTests
{
    private static Block Read(string json) => JsonSerializer.Deserialize<Block>(json)!;

    private const string FutureTypeJson =
        """{"id":"11111111-2222-3333-4444-555555555555","sid":"k3m9p","type":"Timeline","order":3,"spans":[{"kind":"text","text":"1969"}],"payload":{"kind":"empty"},"meta":{}}""";

    private const string FuturePayloadJson =
        """{"id":"11111111-2222-3333-4444-555555555555","sid":"k3m9p","type":"Text","order":0,"spans":[{"kind":"text","text":"hi"}],"payload":{"kind":"timeline","start":1969,"labels":["one","two"]},"meta":{}}""";

    [Fact]
    public void A_block_type_this_build_does_not_know_reads_as_text_so_the_rest_of_the_note_still_loads()
    {
        var block = Read(FutureTypeJson);

        Assert.Equal(BlockType.Text, block.Type);
        Assert.Equal("Timeline", block.UnknownType);
        Assert.Equal("k3m9p", block.Sid);
        Assert.Equal("1969", block.Content);
    }

    [Fact]
    public void A_block_type_this_build_does_not_know_is_written_back_as_it_arrived()
    {
        var json = JsonSerializer.Serialize(Read(FutureTypeJson));

        Assert.Contains("\"type\":\"Timeline\"", json);
        Assert.DoesNotContain("\"type\":\"Text\"", json);
    }

    [Fact]
    public void Giving_a_block_a_type_retires_the_token_this_build_could_not_read()
    {
        var block = Read(FutureTypeJson);
        block.Type = BlockType.Heading1;

        var json = JsonSerializer.Serialize(block);

        Assert.Null(block.UnknownType);
        Assert.Contains("\"type\":\"Heading1\"", json);
        Assert.DoesNotContain("Timeline", json);
    }

    [Fact]
    public void A_payload_kind_this_build_does_not_know_does_not_fail_the_read()
    {
        var block = Read(FuturePayloadJson);

        Assert.IsType<EmptyPayload>(block.Payload);
        Assert.NotNull(block.UnknownPayloadJson);
        Assert.Equal("hi", block.Content);
    }

    [Fact]
    public void A_payload_this_build_does_not_know_is_written_back_as_it_arrived()
    {
        var json = JsonSerializer.Serialize(Read(FuturePayloadJson));

        Assert.Contains("\"kind\":\"timeline\"", json);
        Assert.Contains("\"start\":1969", json);
        Assert.Contains("\"labels\":[\"one\",\"two\"]", json);
        Assert.DoesNotContain("\"kind\":\"empty\"", json);
    }

    [Fact]
    public void Giving_a_block_a_payload_retires_the_one_this_build_could_not_read()
    {
        var block = Read(FuturePayloadJson);
        block.Payload = new ChecklistPayload(true);

        var json = JsonSerializer.Serialize(block);

        Assert.Null(block.UnknownPayloadJson);
        Assert.Contains("\"kind\":\"checklist\"", json);
        Assert.DoesNotContain("timeline", json);
    }

    [Fact]
    public void A_block_from_a_newer_version_nested_in_a_column_also_survives()
    {
        var json = $$"""
            {"id":"aaaa","sid":"aaaaa","type":"TwoColumn","order":0,"payload":{"kind":"twoColumn","splitRatio":0.5},"meta":{},"children":[{{FutureTypeJson}}]}
            """;

        var written = JsonSerializer.Serialize(Read(json));

        Assert.Contains("\"type\":\"Timeline\"", written);
    }

    [Fact]
    public void A_note_holding_a_block_from_a_newer_version_still_loads()
    {
        var stored = $$"""
            {"NoteId":"n1","Title":"From the future","Ver":4,"Blocks":[{{FuturePayloadJson}},{{FutureTypeJson}}]}
            """;

        var note = JsonSerializer.Deserialize<Note>(stored);

        Assert.NotNull(note);
        Assert.Equal("From the future", note!.Title);
        Assert.Equal(2, note.Blocks!.Count);
    }

    [Fact]
    public void A_note_holding_a_block_from_a_newer_version_saves_that_block_unchanged()
    {
        var stored = $$"""
            {"NoteId":"n1","Title":"From the future","Ver":4,"Blocks":[{{FutureTypeJson}}]}
            """;

        var written = JsonSerializer.Serialize(JsonSerializer.Deserialize<Note>(stored));

        Assert.Contains("\"type\":\"Timeline\"", written);
        Assert.Contains("\"sid\":\"k3m9p\"", written);
    }
}
