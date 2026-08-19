using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Host.Contracts;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// Card types and the material filled into them, through the real routes. A fact save does not
/// write a card directly, it hands back whatever the layout materializer made from the values it
/// was given, so the coverage that matters here is the round trip: define a type with a layout,
/// fill it in, and check the card that came out rather than trusting the wiring by inspection.
/// </summary>
public sealed class FlashcardFactHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task SavingMaterialAgainstALayoutTypeMaterializesACard()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Facts");
        var typeId = await CreateCardTypeAsync(h);

        var response = await h.Client.PostAsync("/api/facts", JsonBody(new
        {
            deckId,
            typeId,
            values = new Dictionary<string, string> { ["front"] = "capital of France", ["back"] = "Paris" },
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = Parse<FactSavedDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, saved.Added);
        Assert.Single(saved.Cards);
        Assert.Equal("capital of France", saved.Cards[0].Front);
        Assert.Equal("Paris", saved.Cards[0].Back);

        var page = await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json);
        Assert.Equal(1, page!.TotalCount);
    }

    [Fact]
    public async Task MaterialWithNoDeckIsRefusedBeforeTouchingTheStore()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var typeId = await CreateCardTypeAsync(h);

        var response = await h.Client.PostAsync("/api/facts", JsonBody(new
        {
            deckId = "",
            typeId,
            values = new Dictionary<string, string> { ["front"] = "x", ["back"] = "y" },
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_deck", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task MaterialAgainstAMissingDeckIsA404()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var typeId = await CreateCardTypeAsync(h);

        var response = await h.Client.PostAsync("/api/facts", JsonBody(new
        {
            deckId = "no-such-deck",
            typeId,
            values = new Dictionary<string, string> { ["front"] = "x", ["back"] = "y" },
        }));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("unknown_deck", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task ACardTypeWithNoNameIsRefused()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/card-types", JsonBody(new
        {
            id = (string?)null,
            name = "  ",
            fields = Array.Empty<object>(),
            sortFieldId = (string?)null,
            layouts = Array.Empty<object>(),
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_name", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task DeletingAnUnknownCardTypeIsA404()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.DeleteAsync("/api/card-types/does-not-exist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private static async Task<string> CreateDeckAsync(FlashcardHttpHarness h, string name)
    {
        var response = await h.Client.PostAsync("/api/decks", JsonBody(new { name, folderId = (string?)null, presetId = (string?)null }));
        response.EnsureSuccessStatusCode();
        return Parse<DeckSummaryDto>(await response.Content.ReadAsStringAsync()).Id;
    }

    private static async Task<string> CreateCardTypeAsync(FlashcardHttpHarness h)
    {
        var response = await h.Client.PostAsync("/api/card-types", JsonBody(new
        {
            id = (string?)null,
            name = "Basic",
            fields = new[]
            {
                new { id = "front", name = "Front", hint = (string?)null },
                new { id = "back", name = "Back", hint = (string?)null },
            },
            sortFieldId = "front",
            layouts = new[]
            {
                new { id = "card1", name = "Card 1", front = "{{front}}", back = "{{back}}", requires = (string?)null },
            },
        }));
        response.EnsureSuccessStatusCode();
        return Parse<CardTypeDto>(await response.Content.ReadAsStringAsync()).Id;
    }

    private static StringContent JsonBody(object value) =>
        new(JsonSerializer.Serialize(value, Json), Encoding.UTF8, "application/json");

    private static T Parse<T>(string body) => JsonSerializer.Deserialize<T>(body, Json)!;
}
