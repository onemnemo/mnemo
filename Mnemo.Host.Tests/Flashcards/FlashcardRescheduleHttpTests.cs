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
/// The reschedule routes through TestServer: each mode lands on the next card query, the queue
/// size the dialog quotes is served, and a body the scheduler cannot act on is refused before
/// anything is written.
/// </summary>
public sealed class FlashcardRescheduleHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task ADueDateTurnsANewCardIntoAReviewCardDueThatDay()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Due");
        var card = await CreateCardAsync(h, deckId, "front", "back");

        var response = await h.Client.PostAsync("/api/cards/reschedule/due", JsonBody(new
        {
            cardIds = new[] { card.Id },
            days = 3,
            matchInterval = false,
        }));
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var view = await ViewAsync(h, deckId, card.Id);
        Assert.Equal("review", view.Schedule.FsrsState);
        Assert.Null(view.Schedule.Stability);
        Assert.True(view.Schedule.DueDate > DateTimeOffset.UtcNow.AddDays(1));
        Assert.True(view.Schedule.DueDate < DateTimeOffset.UtcNow.AddDays(4));
    }

    [Fact]
    public async Task StartingOverSendsTheCardBackToNew()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Reset");
        var card = await CreateCardAsync(h, deckId, "front", "back");
        (await h.Client.PostAsync("/api/cards/reschedule/due", JsonBody(new { cardIds = new[] { card.Id }, days = 1, matchInterval = true })))
            .EnsureSuccessStatusCode();
        Assert.Equal("review", (await ViewAsync(h, deckId, card.Id)).Schedule.FsrsState);

        var response = await h.Client.PostAsync("/api/cards/reschedule/reset", JsonBody(new
        {
            cardIds = new[] { card.Id },
            keepCounts = true,
        }));
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var view = await ViewAsync(h, deckId, card.Id);
        Assert.Equal("new", view.Schedule.FsrsState);
        Assert.Null(view.Schedule.Stability);
    }

    [Fact]
    public async Task AQueuePlacementReordersTheNewCardsAndTheQueueSizeIsServed()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Position");
        var first = await CreateCardAsync(h, deckId, "first", "back");
        var second = await CreateCardAsync(h, deckId, "second", "back");
        var third = await CreateCardAsync(h, deckId, "third", "back");

        var queue = await h.Client.GetFromJsonAsync<NewQueueDto>($"/api/decks/{deckId}/new-queue", Json);
        Assert.Equal(3, queue!.Count);

        var response = await h.Client.PostAsync("/api/cards/reschedule/position", JsonBody(new
        {
            cardIds = new[] { third.Id },
            place = "at",
            position = 2,
        }));
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var page = await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards?sort=due", Json);
        Assert.Equal(new[] { first.Id, third.Id, second.Id }, page!.Items.Select(item => item.Card.Id));
    }

    [Fact]
    public async Task AnUnknownPlacementIsRefused()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Bad place");
        var card = await CreateCardAsync(h, deckId, "front", "back");

        var response = await h.Client.PostAsync("/api/cards/reschedule/position", JsonBody(new
        {
            cardIds = new[] { card.Id },
            place = "middle",
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_place", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task ADueDateOutsideTheSchedulersReachIsRefused()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Bad days");
        var card = await CreateCardAsync(h, deckId, "front", "back");

        var response = await h.Client.PostAsync("/api/cards/reschedule/due", JsonBody(new
        {
            cardIds = new[] { card.Id },
            days = -1,
            matchInterval = false,
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_days", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Equal("new", (await ViewAsync(h, deckId, card.Id)).Schedule.FsrsState);
    }

    private static async Task<CardViewDto> ViewAsync(FlashcardHttpHarness h, string deckId, string cardId)
    {
        var page = await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json);
        return page!.Items.Single(item => item.Card.Id == cardId);
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
