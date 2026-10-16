using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Held to the same vectors as <c>splitMath</c> in the web app.</summary>
public sealed class CardMathTests
{
    public static IEnumerable<object[]> Vectors() => Load("cases", item =>
        new object[] { item.GetProperty("name").GetString()!, item.GetProperty("input").GetString()!, Pieces(item) });

    public static IEnumerable<object[]> AnkiVectors() => Load("anki", item =>
        new object[]
        {
            item.GetProperty("field").GetString()!,
            item.GetProperty("card").GetString()!,
            Pieces(item),
        });

    [Theory]
    [MemberData(nameof(Vectors))]
    public void Split_SharedVector_MatchesTheWebRenderer(string name, string input, string[] expected)
    {
        Assert.True(expected.SequenceEqual(Read(input)), name);
    }

    [Theory]
    [MemberData(nameof(AnkiVectors))]
    public void ToCardText_AnkiField_StoresTheFormTheRendererReads(string field, string card, string[] expected)
    {
        Assert.Equal(card, AnkiMathDelimiters.ToCardText(field));
        Assert.True(expected.SequenceEqual(Read(card)), field);
    }

    private static string[] Read(string source) =>
        CardMath.Split(source).Select(p => $"{Label(p.Kind)}|{p.Value}").ToArray();

    private static string[] Pieces(JsonElement item) =>
        item.GetProperty("pieces").EnumerateArray().Select(p => $"{p[0].GetString()}|{p[1].GetString()}").ToArray();

    private static IEnumerable<object[]> Load(string section, System.Func<JsonElement, object[]> row)
    {
        var path = Path.Combine(System.AppContext.BaseDirectory, "Flashcards", "Fixtures", "math-split.json");
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        return document.RootElement.GetProperty(section).EnumerateArray().Select(row).ToList();
    }

    private static string Label(CardMathKind kind) => kind switch
    {
        CardMathKind.Inline => "math",
        CardMathKind.Display => "display",
        _ => "text",
    };
}
