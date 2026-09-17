using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Host.Contracts;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The preset save carries only the editable half of a preset. A fitted FSRS weight vector is
/// written through its own route and is not in that half, so an ordinary save must carry it
/// forward untouched: dropping it would silently put every deck under the preset back on the
/// published defaults, which is exactly the number the optimizer spent a run finding.
/// </summary>
public sealed class FlashcardPresetSaveHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Every key the client reads off a preset.</summary>
    private static readonly string[] PresetKeys =
    [
        "id", "name", "newPerDay", "maxReviewsPerDay", "algorithm", "desiredRetention", "learningSteps",
        "shuffleOrder", "buryRelated", "autoReveal", "nextDayStartsAtHour", "leechThreshold", "leechAction",
        "deckCount", "isStandard", "weights", "createdAt", "updatedAt",
    ];

    [Fact]
    public async Task SavingTheEditableHalfBindsEveryFieldAndKeepsTheFittedVector()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var presetId = await CreatePresetAsync(h);
        var weights = FittedWeights();
        (await h.Client.PutAsync($"/api/presets/{presetId}/weights", JsonBody(new { weights }))).EnsureSuccessStatusCode();

        const string wire = """
            {
              "name": "Intense",
              "newPerDay": 60,
              "maxReviewsPerDay": 500,
              "desiredRetention": 0.95,
              "learningSteps": [2, 15, 60],
              "shuffleOrder": false,
              "buryRelated": true,
              "autoReveal": "five-seconds",
              "nextDayStartsAtHour": 5,
              "leechThreshold": 3,
              "leechAction": "suspend"
            }
            """;

        var response = await h.Client.PutAsync(
            $"/api/presets/{presetId}", new StringContent(wire, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = Parse<PresetDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal("Intense", saved.Name);
        Assert.Equal(60, saved.NewPerDay);
        Assert.Equal(500, saved.MaxReviewsPerDay);
        Assert.Equal(0.95, saved.DesiredRetention);
        Assert.Equal([2, 15, 60], saved.LearningSteps);
        Assert.False(saved.ShuffleOrder);
        Assert.True(saved.BuryRelated);
        Assert.Equal("five-seconds", saved.AutoReveal);
        Assert.Equal(5, saved.NextDayStartsAtHour);
        Assert.Equal(3, saved.LeechThreshold);
        Assert.Equal("suspend", saved.LeechAction);
        Assert.Equal(weights, saved.Weights);

        var listed = Parse<List<PresetDto>>(await (await h.Client.GetAsync("/api/presets")).Content.ReadAsStringAsync())
            .Single(p => p.Id == presetId);
        Assert.Equal(weights, listed.Weights);
    }

    [Fact]
    public async Task ASaveFromAClientThatPredatesTheOptionalFieldsKeepsTheStoredValues()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var presetId = await CreatePresetAsync(h);
        var tuned = await h.Client.PutAsync($"/api/presets/{presetId}", JsonBody(new
        {
            name = "Tuned",
            newPerDay = 20,
            maxReviewsPerDay = 200,
            desiredRetention = 0.9,
            learningSteps = new[] { 1, 10 },
            shuffleOrder = true,
            buryRelated = false,
            autoReveal = "off",
            nextDayStartsAtHour = 6,
            leechThreshold = 5,
            leechAction = "tag",
        }));
        Assert.Equal(HttpStatusCode.OK, tuned.StatusCode);

        var older = await h.Client.PutAsync(
            $"/api/presets/{presetId}",
            new StringContent("""
                {
                  "name": "Tuned again",
                  "newPerDay": 25,
                  "maxReviewsPerDay": 200,
                  "desiredRetention": 0.9,
                  "learningSteps": [1, 10],
                  "shuffleOrder": true,
                  "buryRelated": false,
                  "autoReveal": "off"
                }
                """, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, older.StatusCode);
        var saved = Parse<PresetDto>(await older.Content.ReadAsStringAsync());
        Assert.Equal("Tuned again", saved.Name);
        Assert.Equal(25, saved.NewPerDay);
        Assert.Equal(6, saved.NextDayStartsAtHour);
        Assert.Equal(5, saved.LeechThreshold);
        Assert.Equal("tag", saved.LeechAction);
    }

    [Fact]
    public async Task APresetResponseCarriesEveryKeyTheClientReadsUnderItsCamelCaseName()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        await CreatePresetAsync(h);

        var response = await h.Client.GetAsync("/api/presets");
        response.EnsureSuccessStatusCode();
        using var listing = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        foreach (var preset in listing.RootElement.EnumerateArray())
        {
            var keys = preset.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
            foreach (var key in PresetKeys)
                Assert.Contains(key, keys);
        }
    }

    private static async Task<string> CreatePresetAsync(FlashcardHttpHarness h)
    {
        var response = await h.Client.PostAsync("/api/presets", JsonBody(new
        {
            name = "Custom",
            newPerDay = 20,
            maxReviewsPerDay = 200,
            desiredRetention = 0.9,
            learningSteps = new[] { 1, 10 },
            shuffleOrder = true,
            buryRelated = false,
            autoReveal = "off",
        }));
        response.EnsureSuccessStatusCode();
        return Parse<PresetDto>(await response.Content.ReadAsStringAsync()).Id;
    }

    /// <summary>A 21 slot vector inside every bound, distinct from the published defaults.</summary>
    private static double[] FittedWeights() =>
    [
        0.31, 1.05, 2.9, 15.2, 7.2, 0.6, 2.1,
        0.01, 1.4, 0.12, 1.1, 1.9, 0.11, 0.3,
        2.3, 0.22, 3.1, 0.75, 0.33, 0.15, 0.25
    ];

    private static StringContent JsonBody(object value) =>
        new(JsonSerializer.Serialize(value, Json), Encoding.UTF8, "application/json");

    private static T Parse<T>(string body) => JsonSerializer.Deserialize<T>(body, Json)!;
}
