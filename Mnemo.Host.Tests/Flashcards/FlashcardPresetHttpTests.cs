using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Host.Contracts;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// Presets and the weight vector bound to them. The vector is checked twice in production, once
/// at the route so a bad request reads as one, and once again on the way into the preset service
/// because the route is not the only caller; this exercises the route's own check, which is the
/// half nothing else in the suite reaches through an HTTP request.
/// </summary>
public sealed class FlashcardPresetHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task ListingPresetsSeedsStandardOnAnEmptyProfile()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.GetAsync("/api/presets");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var presets = Parse<List<PresetDto>>(await response.Content.ReadAsStringAsync());
        Assert.Contains(presets, p => p.IsStandard);
    }

    [Fact]
    public async Task AWeightVectorOfTheWrongLengthIsA400CarryingTheErrorCode()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var presetId = await CreatePresetAsync(h);

        var response = await h.Client.PutAsync($"/api/presets/{presetId}/weights", JsonBody(new
        {
            weights = new[] { 1.0, 2.0, 3.0 },
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = Parse<ErrorDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal("invalid_weights", error.Error);

        // Refused before it reached the store: the preset still schedules on the defaults.
        var reloaded = await h.Client.GetAsync("/api/presets");
        var stored = Parse<List<PresetDto>>(await reloaded.Content.ReadAsStringAsync())
            .Single(p => p.Id == presetId);
        Assert.Null(stored.Weights);
    }

    [Fact]
    public async Task AWeightVectorWithASlotOutsideItsBoxIsA400()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var presetId = await CreatePresetAsync(h);
        var weights = Enumerable.Repeat(1.0, 21).ToArray();
        weights[4] = 0.0001; // w4 (the initial stability floor) must be at least 1.0.

        var response = await h.Client.PutAsync($"/api/presets/{presetId}/weights", JsonBody(new { weights }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_weights", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task ASaneWeightVectorIsAcceptedAndReadableBack()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var presetId = await CreatePresetAsync(h);
        var weights = FlashcardDefaultWeights();

        var response = await h.Client.PutAsync($"/api/presets/{presetId}/weights", JsonBody(new { weights }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = Parse<PresetDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal(weights, saved.Weights);
    }

    [Fact]
    public async Task TheStandardPresetCannotBeDeleted()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        await h.Client.GetAsync("/api/presets"); // seeds Standard

        var response = await h.Client.DeleteAsync("/api/presets/preset-standard");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("preset_protected", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task OptimizingAnUnknownPresetIsA404()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/presets/does-not-exist/optimize", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("unknown_preset", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
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

    /// <summary>
    /// A 21 slot vector inside every bound, so the accept-path test proves the route's own check
    /// lets a real vector through rather than proving nothing by never reaching it.
    /// </summary>
    private static double[] FlashcardDefaultWeights() =>
    [
        0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.57, 2.0966,
        0.0069, 1.5261, 0.112, 1.0178, 1.849, 0.1133, 0.3127,
        2.2934, 0.2191, 3.0004, 0.7536, 0.3332, 0.1437, 0.2
    ];

    private static StringContent JsonBody(object value) =>
        new(JsonSerializer.Serialize(value, Json), Encoding.UTF8, "application/json");

    private static T Parse<T>(string body) => JsonSerializer.Deserialize<T>(body, Json)!;
}
