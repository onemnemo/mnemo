using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Host.Contracts;
using Xunit;

namespace Mnemo.Host.Tests.Notes;

/// <summary>
/// The only route that writes a note's body, through its real handler. The outcome names on the
/// wire are what the editor's save path switches on, so they are asserted as the exact strings
/// the client reads rather than through the enum they come from.
/// </summary>
public sealed class NoteContentHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task ACommitOnTheCurrentVersionAppliesAndAdvancesIt()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);

        var response = await CommitAsync(h, note.Id, note.Ver, "req-1", Body("written"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = Parse<NoteCommitResultDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal("Applied", result.Outcome);
        Assert.Equal(note.Ver + 1, result.Ver);

        var stored = await ReadNoteAsync(h, note.Id);
        Assert.Equal(note.Ver + 1, stored.Ver);
        Assert.Equal("written", Assert.Single(stored.Blocks!).Content);
    }

    [Fact]
    public async Task ACommitOnAStaleVersionIsA409CarryingTheVersionToRebaseOnto()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);
        (await CommitAsync(h, note.Id, note.Ver, "req-1", Body("first"))).EnsureSuccessStatusCode();

        var response = await CommitAsync(h, note.Id, note.Ver, "req-2", Body("second"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var result = Parse<NoteCommitResultDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal("Stale", result.Outcome);
        Assert.Equal(note.Ver + 1, result.Ver);

        var stored = await ReadNoteAsync(h, note.Id);
        Assert.Equal("first", Assert.Single(stored.Blocks!).Content);
    }

    [Fact]
    public async Task AReplayedRequestIdIsRecognisedAsTheWriteThatAlreadyLanded()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);
        (await CommitAsync(h, note.Id, note.Ver, "req-1", Body("once"))).EnsureSuccessStatusCode();

        var response = await CommitAsync(h, note.Id, note.Ver, "req-1", Body("once"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = Parse<NoteCommitResultDto>(await response.Content.ReadAsStringAsync());
        Assert.Equal("AlreadyApplied", result.Outcome);
        Assert.Equal(note.Ver + 1, result.Ver);
        Assert.Equal(note.Ver + 1, (await ReadNoteAsync(h, note.Id)).Ver);
    }

    [Fact]
    public async Task ACommitWithoutARequestIdIsRefusedBeforeAnythingIsWritten()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);

        var response = await CommitAsync(h, note.Id, note.Ver, "  ", Body("dropped"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_request", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Equal(note.Ver, (await ReadNoteAsync(h, note.Id)).Ver);
    }

    [Fact]
    public async Task ABlockWithAMalformedSidIsRefusedBeforeAnythingIsWritten()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);

        var response = await CommitAsync(h, note.Id, note.Ver, "req-1", Body("bad", sid: "not a sid"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_block_sid", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Equal(note.Ver, (await ReadNoteAsync(h, note.Id)).Ver);
    }

    [Fact]
    public async Task TwoBlocksSharingASidAreRefusedBeforeAnythingIsWritten()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);
        var blocks = new object[] { TextBlock("one", "abcde"), TextBlock("two", "abcde") };

        var response = await CommitAsync(h, note.Id, note.Ver, "req-1", blocks);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_block_sid", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
        Assert.Equal(note.Ver, (await ReadNoteAsync(h, note.Id)).Ver);
    }

    [Fact]
    public async Task ABlockWithoutASidIsGivenOneOnTheWayIn()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);

        var response = await CommitAsync(h, note.Id, note.Ver, "req-1", new object[] { TextBlock("fresh", sid: "") });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stored = await ReadNoteAsync(h, note.Id);
        Assert.Matches("^[23456789abcdefghjkmnpqrstvwxyz]{5}$", Assert.Single(stored.Blocks!).Sid);
    }

    /// <summary>
    /// An empty list is a note the editor emptied, not a missing field: it is applied as such.
    /// </summary>
    [Fact]
    public async Task AnEmptyBlockListIsAcceptedAndStoredAsEmpty()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();
        var note = await CreateNoteAsync(h);
        (await CommitAsync(h, note.Id, note.Ver, "req-1", Body("filled"))).EnsureSuccessStatusCode();

        var response = await CommitAsync(h, note.Id, note.Ver + 1, "req-2", Array.Empty<object>());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Applied", Parse<NoteCommitResultDto>(await response.Content.ReadAsStringAsync()).Outcome);
        var stored = await ReadNoteAsync(h, note.Id);
        Assert.NotNull(stored.Blocks);
        Assert.Empty(stored.Blocks!);
    }

    [Fact]
    public async Task ACommitAgainstAnUnknownNoteIsA404()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync();

        var response = await CommitAsync(h, "nope", 1, "req-1", Body("lost"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("unknown_note", Parse<ErrorDto>(await response.Content.ReadAsStringAsync()).Error);
    }

    [Fact]
    public async Task EveryNoteRouteAnswers503UntilTheMigrationHasRun()
    {
        await using var h = new NoteContentHttpHarness();
        await h.StartAsync(migrated: false);

        var list = await h.Client.GetAsync("/api/notes");
        var create = await h.Client.PostAsync("/api/notes", JsonBody(new { title = "closed" }));
        var commit = await CommitAsync(h, "any", 1, "req-1", Body("closed"));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, list.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, create.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, commit.StatusCode);
        Assert.Equal("notes_migrating", Parse<ErrorDto>(await commit.Content.ReadAsStringAsync()).Error);

        await h.StartAsync(migrated: true);
        Assert.Equal(HttpStatusCode.OK, (await h.Client.GetAsync("/api/notes")).StatusCode);
    }

    private static object[] Body(string text, string sid = "abcde") => [TextBlock(text, sid)];

    private static object TextBlock(string text, string sid) => new
    {
        type = "Text",
        sid,
        spans = new[] { new { kind = "text", text } },
        payload = new { kind = "empty" },
    };

    private static Task<HttpResponseMessage> CommitAsync(
        NoteContentHttpHarness h, string noteId, long baseVer, string requestId, object[] blocks) =>
        h.Client.PutAsync($"/api/notes/{noteId}/content", JsonBody(new { baseVer, requestId, blocks }));

    private static async Task<NoteDto> CreateNoteAsync(NoteContentHttpHarness h)
    {
        var response = await h.Client.PostAsync("/api/notes", JsonBody(new { title = "Committed" }));
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
