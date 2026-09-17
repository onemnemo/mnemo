using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Host.Contracts;
using Xunit;

namespace Mnemo.Host.Tests.Notes;

/// <summary>
/// The metadata route is a full replace, so a field the request body cannot bind is cleared on
/// every save rather than rejected, and a field the response leaves out is one the sidebar and
/// the pane never see. Both directions are pinned against the camelCase wire the client sends
/// and reads, field by field.
/// </summary>
public sealed class NoteMetadataHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Every key the client reads off a note summary, and so every key a note response must carry.</summary>
    private static readonly string[] SummaryKeys =
    [
        "id", "sid", "ver", "title", "folderId", "parentNoteId", "order", "isFavorite",
        "createdAt", "modifiedAt", "emoji", "cover", "coverCrop", "tags",
    ];

    [Fact]
    public async Task AFullReplaceBindsEveryFieldTheClientSendsAndReadsThemAllBack()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var parent = await CreateNoteAsync(h, "Parent");
        var note = await CreateNoteAsync(h, "Draft");

        var wire = $$"""
            {
              "title": "Pharmacology notes",
              "folderId": null,
              "parentNoteId": "{{parent.Id}}",
              "order": 4,
              "isFavorite": true,
              "emoji": "💊",
              "cover": "asset:cover.png",
              "coverCrop": "{\"x\":0.1,\"y\":0,\"w\":0.8,\"h\":1,\"aspect\":2}",
              "tags": ["exam", "second-year"]
            }
            """;

        var response = await h.Client.PutAsync(
            $"/api/notes/{note.Id}/metadata", new StringContent(wire, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var stored = await ReadNoteAsync(h, note.Id);
        Assert.Equal("Pharmacology notes", stored.Title);
        Assert.Null(stored.FolderId);
        Assert.Equal(parent.Id, stored.ParentNoteId);
        Assert.Equal(4, stored.Order);
        Assert.True(stored.IsFavorite);
        Assert.Equal("💊", stored.Emoji);
        Assert.Equal("asset:cover.png", stored.Cover);
        Assert.Equal("{\"x\":0.1,\"y\":0,\"w\":0.8,\"h\":1,\"aspect\":2}", stored.CoverCrop);
        Assert.Equal(["exam", "second-year"], stored.Tags);

        // Metadata is not part of what the editor edits, so the edit token stays where it was.
        Assert.Equal(note.Ver, stored.Ver);
    }

    [Fact]
    public async Task AReplaceThatLeavesAFieldOutClearsIt()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h, "Draft");
        var decorate = await h.Client.PutAsync($"/api/notes/{note.Id}/metadata", JsonBody(new
        {
            title = "Decorated",
            folderId = (string?)null,
            parentNoteId = (string?)null,
            order = 0,
            isFavorite = true,
            emoji = "💊",
            cover = "asset:cover.png",
            coverCrop = "{}",
            tags = new[] { "exam" },
        }));
        Assert.Equal(HttpStatusCode.NoContent, decorate.StatusCode);

        var bare = await h.Client.PutAsync(
            $"/api/notes/{note.Id}/metadata",
            new StringContent("""{ "title": "Decorated", "order": 0 }""", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NoContent, bare.StatusCode);

        var stored = await ReadNoteAsync(h, note.Id);
        Assert.False(stored.IsFavorite);
        Assert.Null(stored.Emoji);
        Assert.Null(stored.Cover);
        Assert.Null(stored.CoverCrop);
        Assert.Empty(stored.Tags);
    }

    [Fact]
    public async Task ANoteResponseCarriesEveryKeyTheClientReadsUnderItsCamelCaseName()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h, "Keys");

        var single = await h.Client.GetAsync($"/api/notes/{note.Id}");
        single.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(await single.Content.ReadAsStringAsync());
        var keys = body.RootElement.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var key in SummaryKeys.Concat(["content", "blocks"]))
            Assert.Contains(key, keys);

        var list = await h.Client.GetAsync("/api/notes");
        list.EnsureSuccessStatusCode();
        using var listing = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
        var summary = Assert.Single(listing.RootElement.EnumerateArray());
        var summaryKeys = summary.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var key in SummaryKeys)
            Assert.Contains(key, summaryKeys);
    }

    [Fact]
    public async Task ATitleThatIsOnlyWhitespaceIsRefused()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h, "Kept");

        var response = await h.Client.PutAsync($"/api/notes/{note.Id}/metadata", JsonBody(new
        {
            title = "   ",
            folderId = (string?)null,
            parentNoteId = (string?)null,
            order = 0,
            isFavorite = false,
            emoji = (string?)null,
            cover = (string?)null,
            coverCrop = (string?)null,
            tags = Array.Empty<string>(),
        }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_name", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Equal("Kept", (await ReadNoteAsync(h, note.Id)).Title);
    }

    private static async Task<NoteDto> CreateNoteAsync(NoteContentHttpHarness h, string title)
    {
        var response = await h.Client.PostAsync("/api/notes", JsonBody(new { title }));
        response.EnsureSuccessStatusCode();
        return Parse<NoteDto>(await response.Content.ReadAsStringAsync());
    }

    private static async Task<NoteDto> ReadNoteAsync(NoteContentHttpHarness h, string noteId)
    {
        var response = await h.Client.GetAsync($"/api/notes/{noteId}");
        response.EnsureSuccessStatusCode();
        return Parse<NoteDto>(await response.Content.ReadAsStringAsync());
    }

    private static StringContent JsonBody(object body) =>
        new(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");

    private static T Parse<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Json) ?? throw new InvalidOperationException("empty body");
}
