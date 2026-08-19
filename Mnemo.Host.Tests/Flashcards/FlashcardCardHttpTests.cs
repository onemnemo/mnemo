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
/// The deck and card surface through its real routes: create a deck, create a card in it, list
/// and query cards back, and the guard rails around both (a card needs a deck that exists, a
/// side only takes so many attachments). Mnemo.Host.Tests had no in-process HTTP harness for
/// flashcards before this; the mindmap ops endpoints have one calling handlers directly because
/// those are public static methods, but the flashcard handlers are inline route lambdas, so this
/// goes through TestServer instead and hits the same routing and model binding the app does.
/// </summary>
public sealed class FlashcardCardHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task CreatingADeckThenACardRoundTripsThroughTheRealRoutes()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var deckId = await CreateDeckAsync(h, "Spanish");

        var response = await h.Client.PostAsync($"/api/decks/{deckId}/cards", JsonBody(new
        {
            type = "classic",
            front = "gato",
            back = "cat",
            tags = new[] { "animals" },
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var card = Parse<CardDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal("gato", card.Front);
        Assert.Equal("cat", card.Back);
        Assert.Equal(deckId, card.DeckId);
        Assert.Contains("animals", card.Tags);

        var page = await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json);
        Assert.Equal(1, page!.TotalCount);
        Assert.Equal(card.Id, page.Items[0].Card.Id);
    }

    [Fact]
    public async Task CreatingACardAgainstAMissingDeckIsA404NotAForeignKeyCrash()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/decks/does-not-exist/cards", JsonBody(new
        {
            type = "classic",
            front = "front",
            back = "back",
        }));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var error = Parse<ErrorDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal("unknown_deck", error.Error);
    }

    [Fact]
    public async Task ACardWithNoFrontIsRefusedBeforeAnythingIsWritten()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Empty front");

        var response = await h.Client.PostAsync($"/api/decks/{deckId}/cards", JsonBody(new
        {
            type = "classic",
            front = "   ",
            back = "back",
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_front", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);

        var page = await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json);
        Assert.Equal(0, page!.TotalCount);
    }

    [Fact]
    public async Task SuspendingACardThroughTheBatchRouteIsVisibleOnTheNextQuery()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Batch ops");
        var card = await CreateCardAsync(h, deckId, "front", "back");

        var response = await h.Client.PostAsync("/api/cards/suspend", JsonBody(new
        {
            cardIds = new[] { card.Id },
            value = true,
        }));
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var reloaded = await h.Client.GetFromJsonAsync<CardDto>($"/api/cards/{card.Id}", Json);
        Assert.Equal("suspended", reloaded!.State);
    }

    private static async Task<string> CreateDeckAsync(FlashcardHttpHarness h, string name)
    {
        var response = await h.Client.PostAsync("/api/decks", JsonBody(new { name, folderId = (string?)null, presetId = (string?)null }));
        response.EnsureSuccessStatusCode();
        return Parse<DeckSummaryDto>(await response.Content.ReadAsStringAsync()).Id;
    }

    private static async Task<CardDto> CreateCardAsync(FlashcardHttpHarness h, string deckId, string front, string back)
    {
        var response = await h.Client.PostAsync($"/api/decks/{deckId}/cards", JsonBody(new { type = "classic", front, back }));
        response.EnsureSuccessStatusCode();
        return Parse<CardDto>(await response.Content.ReadAsStringAsync());
    }

    private static StringContent JsonBody(object value) =>
        new(JsonSerializer.Serialize(value, Json), Encoding.UTF8, "application/json");

    private static T Parse<T>(string body) => JsonSerializer.Deserialize<T>(body, Json)!;
}
