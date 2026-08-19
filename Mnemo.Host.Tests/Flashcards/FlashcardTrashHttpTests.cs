using System.Linq;
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
/// The four flashcard delete routes now that they hand to the trash: what they answer with, what
/// the library shows afterwards, and what comes back when the answer is fed to Undo.
/// </summary>
/// <remarks>
/// The shape of the answer is the point. Every module's delete route replies with the same
/// <see cref="TrashActionDto"/>, so one presenter can raise the Undo toast for all of them, and a
/// route that went back to answering 204 would take its module out of that.
/// </remarks>
public sealed class FlashcardTrashHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task DeletingADeckAnswersWithAnUndoableEntryAndTakesItOutOfTheLibrary()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Spanish");
        await CreateCardAsync(h, deckId, "gato", "cat");

        var response = await h.Client.DeleteAsync($"/api/decks/{deckId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var action = Parse<TrashActionDto>(await response.Content.ReadAsStringAsync());
        var entry = Assert.Single(action.Entries);
        Assert.Equal("deck", entry.Kind);
        Assert.Equal(deckId, entry.ItemId);
        Assert.Equal("Spanish", entry.Title);
        Assert.Equal(1, entry.ContainedCount);

        var decks = await h.Client.GetFromJsonAsync<DeckSummaryDto[]>("/api/decks", Json);
        Assert.Empty(decks!);
        Assert.Equal(1, (await h.Client.GetFromJsonAsync<TrashCountDto>("/api/trash/count", Json))!.Count);

        var undo = await h.Client.PostAsync($"/api/trash/batches/{action.BatchId}/restore", JsonBody(new { }));
        undo.EnsureSuccessStatusCode();
        var restored = Parse<TrashRestoreResponseDto>(await undo.Content.ReadAsStringAsync());
        Assert.Equal(1, restored.RestoredCount);

        var back = await h.Client.GetFromJsonAsync<DeckSummaryDto[]>("/api/decks", Json);
        Assert.Equal(deckId, Assert.Single(back!).Id);
        var page = await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json);
        Assert.Equal(1, page!.TotalCount);
    }

    [Fact]
    public async Task DeletingADeckThatIsNotThereIsStillA404()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.DeleteAsync("/api/decks/does-not-exist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("unknown_deck", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task DeletingAFolderTakesTheDecksInsideItUnderOneEntry()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var folderId = await CreateFolderAsync(h, "Languages");
        var deckId = await CreateDeckAsync(h, "Spanish", folderId);

        var response = await h.Client.DeleteAsync($"/api/deck-folders/{folderId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var action = Parse<TrashActionDto>(await response.Content.ReadAsStringAsync());
        var entry = Assert.Single(action.Entries);
        Assert.Equal("deck-folder", entry.Kind);
        Assert.Equal(1, entry.ContainedCount);
        Assert.Empty((await h.Client.GetFromJsonAsync<DeckSummaryDto[]>("/api/decks", Json))!);

        var undo = await h.Client.PostAsync($"/api/trash/batches/{action.BatchId}/restore", JsonBody(new { }));
        undo.EnsureSuccessStatusCode();

        // The arrangement comes back, not just the decks: the deck is inside its folder again.
        var back = await h.Client.GetFromJsonAsync<DeckSummaryDto[]>("/api/decks", Json);
        var restoredDeck = Assert.Single(back!);
        Assert.Equal(deckId, restoredDeck.Id);
        Assert.Equal(folderId, restoredDeck.FolderId);
    }

    [Fact]
    public async Task DeletingCardsTogetherPutsThemInOneBatchThatComesBackTogether()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Spanish");
        var first = await CreateCardAsync(h, deckId, "gato", "cat");
        var second = await CreateCardAsync(h, deckId, "perro", "dog");

        var response = await h.Client.PostAsync("/api/cards/delete", JsonBody(new
        {
            cardIds = new[] { first.Id, second.Id },
        }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var action = Parse<TrashActionDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal(2, action.Entries.Count);
        Assert.All(action.Entries, e => Assert.Equal("card", e.Kind));
        Assert.All(action.Entries, e => Assert.Equal(action.BatchId, e.BatchId));
        Assert.Equal(0, (await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json))!.TotalCount);

        var undo = await h.Client.PostAsync($"/api/trash/batches/{action.BatchId}/restore", JsonBody(new { }));
        undo.EnsureSuccessStatusCode();
        Assert.Equal(2, Parse<TrashRestoreResponseDto>(await undo.Content.ReadAsStringAsync()).RestoredCount);
        Assert.Equal(2, (await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json))!.TotalCount);
    }

    [Fact]
    public async Task DeletingNoCardsAtAllIsRefusedRatherThanMakingAnEmptyBatch()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/cards/delete", JsonBody(new { cardIds = new string[0] }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("no_cards", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Equal(0, (await h.Client.GetFromJsonAsync<TrashCountDto>("/api/trash/count", Json))!.Count);
    }

    [Fact]
    public async Task DeletingMaterialTakesTheCardsItMakesAndGivesThemBack()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Geology");

        var saved = await h.Client.PostAsync("/api/facts", JsonBody(new
        {
            deckId,
            typeId = "cloze",
            values = new { text = "{{c1::Granite}} and {{c2::Basalt}}" },
        }));
        saved.EnsureSuccessStatusCode();
        var factId = Parse<FactSavedDto>(await saved.Content.ReadAsStringAsync()).Fact.Id;
        Assert.Equal(2, (await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json))!.TotalCount);

        var response = await h.Client.PostAsync("/api/facts/delete", JsonBody(new { factIds = new[] { factId } }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var action = Parse<TrashActionDto>(await response.Content.ReadAsStringAsync());
        var entry = Assert.Single(action.Entries);
        Assert.Equal("fact", entry.Kind);
        Assert.Equal(2, entry.ContainedCount);
        Assert.Equal(0, (await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json))!.TotalCount);

        var undo = await h.Client.PostAsync($"/api/trash/batches/{action.BatchId}/restore", JsonBody(new { }));
        undo.EnsureSuccessStatusCode();
        Assert.Equal(2, (await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deckId}/cards", Json))!.TotalCount);
    }

    [Fact]
    public async Task DeletingNoMaterialAtAllIsRefused()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/facts/delete", JsonBody(new { factIds = new[] { "  " } }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("no_facts", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task AHeldDeckIsGoneFromTheLibraryButStillCountedInTheTrash()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h, "Spanish");
        await h.Client.DeleteAsync($"/api/decks/{deckId}");

        // Nothing may reach a held deck through the ordinary surface, or somebody could study or
        // edit their way into content the app is telling them is deleted.
        Assert.Equal(HttpStatusCode.NotFound, (await h.Client.GetAsync($"/api/decks/{deckId}")).StatusCode);

        var page = await h.Client.GetFromJsonAsync<TrashPageDto>("/api/trash", Json);
        var entry = Assert.Single(page!.Entries);
        Assert.Equal(deckId, entry.ItemId);
        Assert.True(entry.SourceAvailable);
    }

    private static async Task<string> CreateFolderAsync(FlashcardHttpHarness h, string name)
    {
        var response = await h.Client.PostAsync("/api/deck-folders", JsonBody(new { name, parentId = (string?)null }));
        response.EnsureSuccessStatusCode();
        return Parse<FolderDto>(await response.Content.ReadAsStringAsync()).Id;
    }

    private static async Task<string> CreateDeckAsync(FlashcardHttpHarness h, string name, string? folderId = null)
    {
        var response = await h.Client.PostAsync("/api/decks", JsonBody(new { name, folderId, presetId = (string?)null }));
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
