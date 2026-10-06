using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>The masks document and the cards it makes, from a fixture the web tests read too.</summary>
public sealed class FlashcardOcclusionTests
{
    private static readonly JsonElement Fixture = LoadFixture();

    public static TheoryData<string> ParseCases() => Names("parse");

    public static TheoryData<string> GenerateCases() => Names("generate");

    [Theory]
    [MemberData(nameof(ParseCases))]
    public void Parsing_and_writing_matches_the_shared_fixture(string name)
    {
        var item = Case("parse", name);
        var input = item.GetProperty("input");
        var text = input.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.String => input.GetString(),
            _ => input.GetRawText(),
        };

        var document = FlashcardOcclusion.Parse(text);

        Assert.Equal(item.GetProperty("canonical").GetString(), FlashcardOcclusion.Serialize(document));
    }

    [Theory]
    [MemberData(nameof(GenerateCases))]
    public void Generation_matches_the_shared_fixture(string name)
    {
        var item = Case("generate", name);
        var type = FlashcardCardType.CreateBuiltIns(DateTimeOffset.UnixEpoch)
            .Single(t => t.Id == FlashcardCardType.OcclusionId);
        var masks = item.GetProperty("masks");
        var fact = Fact(
            item.GetProperty("front").GetString()!,
            masks.ValueKind == JsonValueKind.String ? masks.GetString()! : masks.GetRawText(),
            item.GetProperty("image").GetBoolean());

        var generated = FlashcardGeneration.Generate(type, fact);
        var expected = item.GetProperty("expected").EnumerateArray().ToArray();

        Assert.Equal(expected.Length, generated.Count);
        var units = FlashcardOcclusionUnits.Build(
            FlashcardOcclusion.Parse(fact.Value(FlashcardCardType.OcclusionMasksFieldId))).Units;
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i].GetProperty("key").GetString(), generated[i].Key);
            Assert.Equal(expected[i].GetProperty("front").GetString(), generated[i].Front);
            Assert.Equal(expected[i].GetProperty("back").GetString(), generated[i].Back);
            Assert.Equal(
                expected[i].GetProperty("members").EnumerateArray().Single().EnumerateArray().Select(e => e.GetString()),
                units[i].Members.Select(m => m.Id));
        }
    }

    [Fact]
    public void A_generated_card_carries_only_the_first_image()
    {
        var type = FlashcardCardType.CreateBuiltIns(DateTimeOffset.UnixEpoch)
            .Single(t => t.Id == FlashcardCardType.OcclusionId);
        var fact = Fact("Q", OneMask("a1"), true) with
        {
            Media = new Dictionary<string, IReadOnlyList<FlashcardAttachment>>
            {
                [FlashcardCardType.OcclusionImageFieldId] = [Image("first"), Image("second")],
            },
        };

        var card = Assert.Single(FlashcardGeneration.Generate(type, fact));

        Assert.Equal(["first"], card.FrontMedia.Select(a => a.Id));
        Assert.Empty(card.BackMedia);
    }

    [Fact]
    public void The_fact_back_text_is_not_copied_into_cards()
    {
        var type = FlashcardCardType.CreateBuiltIns(DateTimeOffset.UnixEpoch)
            .Single(t => t.Id == FlashcardCardType.OcclusionId);
        var fact = Fact("Q", OneMask("a1"), true) with
        {
            Values = new Dictionary<string, string>
            {
                [FlashcardCardType.OcclusionFrontFieldId] = "Q",
                [FlashcardCardType.OcclusionBackFieldId] = "Extra text",
                [FlashcardCardType.OcclusionMasksFieldId] = OneMask("a1"),
            },
        };

        Assert.Equal(string.Empty, Assert.Single(FlashcardGeneration.Generate(type, fact)).Back);
    }

    [Fact]
    public void Fields_are_read_by_their_fixed_ids_whatever_the_type_now_lists()
    {
        var type = FlashcardCardType.CreateBuiltIns(DateTimeOffset.UnixEpoch)
            .Single(t => t.Id == FlashcardCardType.OcclusionId) with { Fields = [] };

        Assert.Single(FlashcardGeneration.Generate(type, Fact("Q", OneMask("a1"), true)));
    }

    [Fact]
    public void Material_without_the_fields_makes_no_cards_rather_than_throwing()
    {
        var type = FlashcardCardType.CreateBuiltIns(DateTimeOffset.UnixEpoch)
            .Single(t => t.Id == FlashcardCardType.OcclusionId);
        var bare = Fact("Q", OneMask("a1"), false) with
        {
            Values = new Dictionary<string, string>(),
        };

        Assert.Empty(FlashcardGeneration.Generate(type, bare));
    }

    [Fact]
    public void Masks_past_the_cap_are_ignored_on_read()
    {
        var masks = string.Join(",", Enumerable.Range(0, FlashcardOcclusion.MaxMasks + 20)
            .Select(i => $$"""{"id":"m{{i}}","shape":"rect","x":0.1,"y":0.1,"w":0.1,"h":0.1,"order":{{i}}}"""));

        var document = FlashcardOcclusion.Parse($$"""{"v":1,"masks":[{{masks}}]}""");

        Assert.Equal(FlashcardOcclusion.MaxMasks, document.Masks.Count);
    }

    [Fact]
    public void Polygon_points_past_the_cap_are_ignored_on_read()
    {
        var points = string.Join(",", Enumerable.Range(0, FlashcardOcclusion.MaxPoints + 30)
            .Select(i => FormattableString.Invariant($"[{(i % 90 + 5) / 100.0},{(i % 50 + 5) / 100.0}]")));

        var document = FlashcardOcclusion.Parse($$"""{"v":1,"masks":[{"id":"p1","shape":"polygon","points":[{{points}}]}]}""");

        Assert.Equal(FlashcardOcclusion.MaxPoints, Assert.Single(document.Masks).Points!.Count);
    }

    [Fact]
    public void A_written_document_reads_back_unchanged()
    {
        var first = FlashcardOcclusion.Parse(Fixture.GetProperty("parse")[0].GetProperty("input").GetRawText());

        var second = FlashcardOcclusion.Parse(FlashcardOcclusion.Serialize(first));

        Assert.Equal(first.Mode, second.Mode);
        Assert.Equal(first.Masks.Count, second.Masks.Count);
        for (var i = 0; i < first.Masks.Count; i++)
        {
            var (a, b) = (first.Masks[i], second.Masks[i]);
            Assert.Equal((a.Id, a.Shape, a.X, a.Y, a.W, a.H, a.Label, a.Group, a.Order), (b.Id, b.Shape, b.X, b.Y, b.W, b.H, b.Label, b.Group, b.Order));
            Assert.Equal(a.Points?.Select(p => (p[0], p[1])), b.Points?.Select(p => (p[0], p[1])));
        }

        var polygon = second.Masks[2];
        Assert.Equal((0.2, 0.2, 0.4, 0.6), (polygon.X, polygon.Y, polygon.W, polygon.H));
        Assert.Equal(3, polygon.Points!.Count);
        Assert.Equal("Wall", polygon.Label);
    }

    [Theory]
    [MemberData(nameof(ParseCases))]
    public void Canonical_text_is_a_fixed_point_of_parse_and_write(string name)
    {
        var canonical = Case("parse", name).GetProperty("canonical").GetString();

        Assert.Equal(canonical, FlashcardOcclusion.Serialize(FlashcardOcclusion.Parse(canonical)));
    }

    [Fact]
    public void Colliding_units_are_reported_for_the_editor()
    {
        var document = FlashcardOcclusion.Parse(
            """
            {"v":1,"masks":[
              {"id":"x1","shape":"rect","x":0.1,"y":0.1,"w":0.1,"h":0.1,"order":0},
              {"id":"y2","shape":"rect","x":0.3,"y":0.1,"w":0.1,"h":0.1,"group":"x1","order":1}]}
            """);

        var set = FlashcardOcclusionUnits.Build(document);

        Assert.Equal(["mx1"], set.Units.Select(u => u.Key));
        Assert.Equal(["mx1"], set.Collisions);
    }

    [Theory]
    [InlineData("a1", true)]
    [InlineData("k3f9a2b1", true)]
    [InlineData("", false)]
    [InlineData("A1", false)]
    [InlineData("a-1", false)]
    [InlineData("abcdefghijklmnopq", false)]
    public void Ids_become_part_of_a_card_key_only_when_they_are_plain(string id, bool valid)
    {
        Assert.Equal(valid, FlashcardOcclusion.IsValidId(id));
    }

    private static string OneMask(string id) =>
        $$"""{"v":1,"masks":[{"id":"{{id}}","shape":"rect","x":0.1,"y":0.1,"w":0.2,"h":0.2,"order":0}]}""";

    private static FlashcardAttachment Image(string id) =>
        new(id, FlashcardAttachment.FrontSide, $"C:/images/{id}.png", $"{id}.png", 100);

    private static FlashcardFact Fact(string front, string masks, bool withImage) =>
        new(
            Id: "fact-1",
            DeckId: "deck-1",
            TypeId: FlashcardCardType.OcclusionId,
            Values: new Dictionary<string, string>
            {
                [FlashcardCardType.OcclusionFrontFieldId] = front,
                [FlashcardCardType.OcclusionMasksFieldId] = masks,
            },
            Media: withImage
                ? new Dictionary<string, IReadOnlyList<FlashcardAttachment>>
                {
                    [FlashcardCardType.OcclusionImageFieldId] = [Image("diagram")],
                }
                : new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
            Tags: [],
            IsFlagged: false);

    private static TheoryData<string> Names(string section)
    {
        var data = new TheoryData<string>();
        foreach (var item in Fixture.GetProperty(section).EnumerateArray())
            data.Add(item.GetProperty("name").GetString()!);
        return data;
    }

    private static JsonElement Case(string section, string name) =>
        Fixture.GetProperty(section).EnumerateArray().Single(i => i.GetProperty("name").GetString() == name);

    private static JsonElement LoadFixture()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Flashcards", "Fixtures", "occlusion-generation.json");
        return JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
    }
}
