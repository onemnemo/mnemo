using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// A day with no reviews has to reach the client as an explicit null, and a day of only failed
/// answers as a real 0. Either one dropped from the wire reads wrong in the widget.
/// </summary>
public sealed class RetentionTrendWireTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task ADayWithoutReviewsIsWrittenAsAnExplicitNull()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h);

        using var doc = await TrendAsync(h, deckId);

        Assert.Equal(3, doc.RootElement.GetArrayLength());
        foreach (var point in doc.RootElement.EnumerateArray())
        {
            Assert.True(point.TryGetProperty("retentionPercent", out var retention), "retentionPercent must be present");
            Assert.Equal(JsonValueKind.Null, retention.ValueKind);
            Assert.Equal(0, point.GetProperty("reviewsCount").GetInt32());
        }
    }

    [Fact]
    public async Task ARealZeroIsWrittenAsZero_NotDroppedAsADefault()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deckId = await CreateDeckAsync(h);
        var reviews = new ReviewRepository();
        await h.Store.WriteAsync((conn, tx, ct) => reviews.AppendAsync(conn, tx, new FlashcardReviewLog(
            FlashcardReviewLog.Unassigned, "c0", deckId, "s1", FlashcardReviewGrade.Again, DateTimeOffset.UtcNow, 0, 1, null, null,
            FlashcardFsrsState.Review, FlashcardFsrsState.Review), ct));

        using var doc = await TrendAsync(h, deckId);

        var today = doc.RootElement[doc.RootElement.GetArrayLength() - 1];
        Assert.Equal(1, today.GetProperty("reviewsCount").GetInt32());
        Assert.True(today.TryGetProperty("retentionPercent", out var retention), "retentionPercent must be present");
        Assert.Equal(JsonValueKind.Number, retention.ValueKind);
        Assert.Equal(0, retention.GetInt32());
    }

    private static async Task<string> CreateDeckAsync(FlashcardHttpHarness h)
    {
        var created = await h.Client.PostAsync("/api/decks", new StringContent(
            JsonSerializer.Serialize(new { name = "Quiet", folderId = (string?)null, presetId = (string?)null }, Json),
            Encoding.UTF8,
            "application/json"));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        return JsonSerializer.Deserialize<DeckSummaryDto>(await created.Content.ReadAsStringAsync(), Json)!.Id;
    }

    private static async Task<JsonDocument> TrendAsync(FlashcardHttpHarness h, string deckId)
    {
        var response = await h.Client.GetAsync($"/api/decks/{deckId}/retention-trend?days=3");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }
}
