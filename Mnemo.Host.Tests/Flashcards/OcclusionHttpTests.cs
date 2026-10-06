using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Flashcards;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>Image occlusion cards over the real routes: wire tokens, the one-card payload and the masks length limit.</summary>
public sealed class OcclusionHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private const string Masks =
        """{"v":1,"mode":"hideOne","masks":[{"id":"aa","shape":"rect","x":0.1,"y":0.1,"w":0.2,"h":0.2,"label":"One","order":0},{"id":"bb","shape":"ellipse","x":0.5,"y":0.5,"w":0.2,"h":0.2,"label":"Two","group":"bb","order":1},{"id":"cc","shape":"rect","x":0.7,"y":0.1,"w":0.1,"h":0.1,"group":"bb","order":2}]}""";

    [Fact]
    public void The_occlusion_type_crosses_the_wire_as_its_own_token()
    {
        Assert.Equal("occlusion", FlashcardWire.Type(FlashcardType.Occlusion));
        Assert.Equal(FlashcardType.Occlusion, FlashcardWire.ParseType("occlusion"));
        Assert.Equal(FlashcardType.Occlusion, FlashcardWire.ParseType("OCCLUSION"));
        Assert.Equal(FlashcardType.Occlusion, FlashcardWire.ParseTypeOrNull("occlusion"));
        Assert.Null(FlashcardWire.ParseTypeOrNull("sideways"));
        Assert.Equal(FlashcardType.Classic, FlashcardWire.ParseType("sideways"));
    }

    [Fact]
    public async Task The_seeded_type_is_listed_with_its_fixed_fields()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var summaries = await h.Client.GetFromJsonAsync<List<CardTypeSummaryDto>>("/api/card-types", Json);

        var type = Assert.Single(summaries!, s => s.Type.Id == "occlusion").Type;
        Assert.True(type.IsBuiltIn);
        Assert.Equal("occlusion", type.Generator);
        Assert.Equal("image", type.GenerateFrom);
        Assert.Equal(["image", "front", "back", "masks"], type.Fields.Select(f => f.Id));
    }

    [Fact]
    public async Task A_card_made_from_material_cannot_be_rewritten_through_the_card_route()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deck = await CreateDeckAsync(h);
        var saved = await SaveAsync(h.Facts, deck, withManagedImage: true);
        var card = saved.Cards[0];

        var response = await h.Client.PutAsJsonAsync($"/api/cards/{card.Id}", new { front = "Plain", back = "Text" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var fetched = await h.Client.GetFromJsonAsync<CardDto>($"/api/cards/{card.Id}", Json);
        Assert.Equal("occlusion", fetched!.Type);
        Assert.NotNull(fetched.Occlusion);
    }

    [Fact]
    public async Task A_card_fetched_by_id_carries_the_payload_and_a_list_does_not()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deck = await CreateDeckAsync(h);
        var saved = await SaveAsync(h.Facts, deck, withManagedImage: true);
        var group = saved.Cards.Single(c => c.LayoutKey == "mbb");

        var one = await h.Client.GetFromJsonAsync<CardDto>($"/api/cards/{group.Id}", Json);
        var page = await h.Client.GetFromJsonAsync<CardPageDto>($"/api/decks/{deck}/cards", Json);

        Assert.Equal("occlusion", one!.Type);
        var occlusion = one.Occlusion!;
        Assert.Equal("hideOne", occlusion.Mode);
        Assert.Equal(["aa", "bb", "cc"], occlusion.Masks.Select(m => m.Id));
        Assert.Equal(["bb", "cc"], occlusion.AskedIds);
        Assert.Equal("Shown with every answer", occlusion.Back);
        Assert.NotNull(occlusion.ImageAssetId);
        Assert.All(page!.Items, v => Assert.Null(v.Card.Occlusion));
        Assert.All(page.Items, v => Assert.Equal("occlusion", v.Card.Type));
    }

    [Fact]
    public async Task A_payload_for_an_image_outside_the_managed_folder_has_no_asset_id()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deck = await CreateDeckAsync(h);
        var saved = await SaveAsync(h.Facts, deck, withManagedImage: false);

        var card = await h.Client.GetFromJsonAsync<CardDto>($"/api/cards/{saved.Cards[0].Id}", Json);

        Assert.NotNull(card!.Occlusion);
        Assert.Null(card.Occlusion!.ImageAssetId);
    }

    [Fact]
    public async Task A_test_queue_card_carries_the_payload()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deck = await CreateDeckAsync(h);
        await SaveAsync(h.Facts, deck, withManagedImage: true);

        var queue = await h.Client.GetFromJsonAsync<TestQueueDto>($"/api/decks/{deck}/test-queue", Json);

        Assert.Equal(2, queue!.Cards.Count);
        Assert.All(queue.Cards, c => Assert.NotNull(c.Occlusion));
    }

    [Fact]
    public async Task A_classic_card_has_no_payload()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deck = await CreateDeckAsync(h);
        var created = await h.Client.PostAsync($"/api/decks/{deck}/cards", Body(new { type = "classic", front = "Q", back = "A" }));
        var card = JsonSerializer.Deserialize<CardDto>(await created.Content.ReadAsStringAsync(), Json)!;

        var fetched = await h.Client.GetFromJsonAsync<CardDto>($"/api/cards/{card.Id}", Json);

        Assert.Null(fetched!.Occlusion);
    }

    [Fact]
    public async Task A_loose_card_sent_as_occlusion_is_stored_as_classic()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deck = await CreateDeckAsync(h);
        var created = await h.Client.PostAsync($"/api/decks/{deck}/cards", Body(new { type = "occlusion", front = "Q", back = "A" }));
        var card = JsonSerializer.Deserialize<CardDto>(await created.Content.ReadAsStringAsync(), Json)!;

        var fetched = await h.Client.GetFromJsonAsync<CardDto>($"/api/cards/{card.Id}", Json);

        Assert.Equal("classic", fetched!.Type);
        Assert.Null(fetched.Occlusion);
    }

    [Fact]
    public async Task The_masks_field_may_run_past_the_ordinary_limit_but_not_past_its_own()
    {
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var deck = await CreateDeckAsync(h);

        var roomy = await PostFactAsync(h, deck, masks: new string(' ', 25_000) + Masks, front: "Q");
        var tooLong = await PostFactAsync(h, deck, masks: new string(' ', FlashcardOcclusion.MaxFieldLength) + Masks, front: "Q");
        var longFront = await PostFactAsync(h, deck, masks: Masks, front: new string('x', 25_000));

        // No image was sent, so the roomy one is refused for making no cards, after the length check.
        Assert.Equal("invalid_fact", await ErrorCodeAsync(roomy));
        Assert.Equal("invalid_value", await ErrorCodeAsync(tooLong));
        Assert.Equal("invalid_value", await ErrorCodeAsync(longFront));
    }

    [Fact]
    public async Task The_current_study_card_carries_the_payload()
    {
        await using var h = new StudySessionHttpHarness();
        await h.StartAsync();
        var deck = await h.Library.CreateDeckAsync("Occlusion");
        await SaveAsync(h.Facts, deck.Id, withManagedImage: true);

        var response = await h.Client.PostAsync("/api/study/sessions", Body(new { deckId = deck.Id, mode = "review" }));
        var session = JsonSerializer.Deserialize<StudySessionDto>(await response.Content.ReadAsStringAsync(), Json)!;

        Assert.Equal("occlusion", session.Current!.Type);
        Assert.NotNull(session.Current.Occlusion);
        Assert.Equal(3, session.Current.Occlusion!.Masks.Count);
        Assert.Contains(session.Current.Occlusion.AskedIds, id => id is "aa" or "bb");
    }

    private static async Task<string> CreateDeckAsync(FlashcardHttpHarness h)
    {
        var response = await h.Client.PostAsync("/api/decks", Body(new { name = "Occlusion" }));
        return JsonSerializer.Deserialize<DeckSummaryDto>(await response.Content.ReadAsStringAsync(), Json)!.Id;
    }

    private static Task<HttpResponseMessage> PostFactAsync(FlashcardHttpHarness h, string deckId, string masks, string front) =>
        h.Client.PostAsync("/api/facts", Body(new
        {
            deckId,
            typeId = "occlusion",
            values = new Dictionary<string, string> { ["front"] = front, ["masks"] = masks },
        }));

    private static Task<FlashcardFactSaved> SaveAsync(IFlashcardFactService facts, string deckId, bool withManagedImage)
    {
        var path = withManagedImage
            ? Path.Combine(FlashcardAssetStore.Directory, FlashcardAssetStore.Generate(".png"))
            : "C:/elsewhere/diagram.png";
        return facts.SaveFactAsync(new FlashcardFactDraft(
            null,
            deckId,
            FlashcardCardType.OcclusionId,
            new Dictionary<string, string>
            {
                [FlashcardCardType.OcclusionFrontFieldId] = "Label the cell",
                [FlashcardCardType.OcclusionBackFieldId] = "Shown with every answer",
                [FlashcardCardType.OcclusionMasksFieldId] = Masks,
            },
            new Dictionary<string, IReadOnlyList<FlashcardAttachment>>
            {
                [FlashcardCardType.OcclusionImageFieldId] =
                    [new FlashcardAttachment("img1", FlashcardAttachment.FrontSide, path, "diagram.png", 10)],
            },
            []));
    }

    private static async Task<string> ErrorCodeAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return JsonSerializer.Deserialize<ErrorDto>(await response.Content.ReadAsStringAsync(), Json)!.Error;
    }

    private static StringContent Body(object value) =>
        new(JsonSerializer.Serialize(value, Json), Encoding.UTF8, "application/json");
}
