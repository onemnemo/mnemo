using System.Text.Json;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Tests;

public class BlockJsonSidTests
{
    private static Block RoundTrip(Block block) =>
        JsonSerializer.Deserialize<Block>(JsonSerializer.Serialize(block))!;

    [Fact]
    public void Sid_survives_a_round_trip()
    {
        var block = new Block { Type = BlockType.Text, Sid = "k3m9p" };

        Assert.Equal("k3m9p", RoundTrip(block).Sid);
    }

    [Fact]
    public void Sids_on_nested_children_survive_a_round_trip()
    {
        var block = new Block
        {
            Type = BlockType.TwoColumn,
            Sid = "aaaaa",
            Children =
            [
                new Block { Type = BlockType.Text, Sid = "bbbbb" },
                new Block
                {
                    Type = BlockType.Text,
                    Sid = "ccccc",
                    Children = [new Block { Type = BlockType.Text, Sid = "ddddd" }],
                },
            ],
        };

        var result = RoundTrip(block);

        Assert.Equal("aaaaa", result.Sid);
        Assert.Equal("bbbbb", result.Children![0].Sid);
        Assert.Equal("ccccc", result.Children[1].Sid);
        Assert.Equal("ddddd", result.Children[1].Children![0].Sid);
    }

    [Fact]
    public void A_block_stored_before_the_migration_reads_back_with_an_empty_sid()
    {
        var stored = """{"id":"11111111-2222-3333-4444-555555555555","type":"Text","order":0}""";

        Assert.Equal(string.Empty, JsonSerializer.Deserialize<Block>(stored)!.Sid);
    }

    // The migration is the only thing that should ever add a sid to stored data. If merely loading
    // and saving an unmigrated note introduced the key, every read path would quietly rewrite user
    // content, and the byte-identical round-trip the read endpoints rely on would stop holding.
    [Fact]
    public void An_unassigned_sid_is_not_written_to_json()
    {
        var json = JsonSerializer.Serialize(new Block { Type = BlockType.Text });

        Assert.DoesNotContain("\"sid\"", json);
    }

    [Fact]
    public void An_assigned_sid_is_written_to_json()
    {
        var json = JsonSerializer.Serialize(new Block { Type = BlockType.Text, Sid = "k3m9p" });

        Assert.Contains("\"sid\":\"k3m9p\"", json);
    }
}
