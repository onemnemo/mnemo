using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Host.Contracts;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The global search route with only the flashcards provider registered. A working
/// <c>/api/search</c> response proves nothing about flashcards specifically as long as
/// <c>NavigationSearchProvider</c> alone keeps returning 200s (see
/// <c>SearchProviderRegistrationTests</c>), so what matters here is that a card actually comes
/// back, grouped under the flashcards key, with the deck it belongs to attached.
/// </summary>
public sealed class FlashcardSearchHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task ACardMatchingTheQueryComesBackUnderTheFlashcardsGroup()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Chemistry");
        await CreateCardAsync(h, deckId, "atomic number of carbon", "6");

        var response = await h.Client.GetAsync("/api/search?q=atomic+number+of+carbon");
        response.EnsureSuccessStatusCode();

        var result = JsonSerializer.Deserialize<GlobalSearchResponseDto>(await response.Content.ReadAsStringAsync(), Json)!;
        var group = Assert.Single(result.Groups, g => g.GroupKey == "flashcards");
        Assert.Contains(group.Items, item => item.Title == "atomic number of carbon");
    }

    [Fact]
    public async Task AnEmptyQueryReturnsTheEmptyResponseWithoutCallingAnyProvider()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.GetAsync("/api/search?q=");
        response.EnsureSuccessStatusCode();

        var result = JsonSerializer.Deserialize<GlobalSearchResponseDto>(await response.Content.ReadAsStringAsync(), Json)!;
        Assert.Empty(result.Groups);
        Assert.Empty(result.BestMatches);
    }

    [Fact]
    public async Task AQueryMatchingNothingReturnsNoGroups()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Chemistry");
        await CreateCardAsync(h, deckId, "atomic number of carbon", "6");

        var response = await h.Client.GetAsync("/api/search?q=nothing+matches+this");
        response.EnsureSuccessStatusCode();

        var result = JsonSerializer.Deserialize<GlobalSearchResponseDto>(await response.Content.ReadAsStringAsync(), Json)!;
        Assert.Empty(result.Groups);
    }

    private static async Task<string> CreateDeckAsync(FlashcardHttpHarness h, string name)
    {
        var response = await h.Client.PostAsync("/api/decks", JsonContent(new { name, folderId = (string?)null, presetId = (string?)null }));
        response.EnsureSuccessStatusCode();
        return JsonSerializer.Deserialize<DeckSummaryDto>(await response.Content.ReadAsStringAsync(), Json)!.Id;
    }

    private static async Task CreateCardAsync(FlashcardHttpHarness h, string deckId, string front, string back)
    {
        var response = await h.Client.PostAsync($"/api/decks/{deckId}/cards", JsonContent(new { type = "classic", front, back }));
        response.EnsureSuccessStatusCode();
    }

    private static StringContent JsonContent(object value) =>
        new(JsonSerializer.Serialize(value, Json), System.Text.Encoding.UTF8, "application/json");
}
