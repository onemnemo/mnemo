using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Host.Contracts;
using Mnemo.Host.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Host.Tests.Proofing;

/// <summary>
/// The wire contract the editor is written against: the shapes, the offsets, the limits and the two
/// refusals.
/// </summary>
public sealed class ProofingEndpointTests
{
    private static readonly string NoteA = Guid.NewGuid().ToString();
    private static readonly string NoteB = Guid.NewGuid().ToString();
    private static readonly string NoteFull = Guid.NewGuid().ToString();

    private static object Paragraphs(params (string Id, string Text)[] items) =>
        new { paragraphs = items.Select(i => new { id = i.Id, text = i.Text }).ToArray() };

    private static string IgnoresUrl(string noteId) => $"/api/proofing/notes/{noteId}/ignores";

    [Fact]
    public async Task StatusAnswersWithEnglishReadyOnACleanProfile()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        Assert.NotNull(status);
        Assert.True(status.Enabled);
        Assert.Equal("en-US", status.Language);
        Assert.Equal(0, status.PersonalWordCount);

        var english = status.Languages.Single(l => l.Id == "en-US");
        Assert.True(english.Installed);
        Assert.True(english.Bundled);
        Assert.False(string.IsNullOrWhiteSpace(english.License.Name));

        foreach (var id in new[] { "de-DE", "nb-NO" })
        {
            var absent = status.Languages.Single(l => l.Id == id);
            Assert.False(absent.Installed);
            Assert.Equal("absent", absent.State);
            Assert.False(string.IsNullOrWhiteSpace(absent.ReasonKey));
        }
    }

    [Fact]
    public async Task TheEffectiveLanguageComesFromTheOlderEditorSettingWhenNothingElseIsStored()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LegacyLanguageKey, "es");

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        Assert.Equal("es-ES", status!.Language);
    }

    [Fact]
    public async Task AnOlderEditorLanguageWithNoDictionaryResolvesToEnglish()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LegacyLanguageKey, "nb");

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        Assert.Equal("en-US", status!.Language);
    }

    [Fact]
    public async Task ACheckReturnsOffsetsIntoTheParagraphItWasSent()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        const string text = "\U0001F389 The fox jumpd over it.";

        var response = await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(("b1:0", text)));
        var body = await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("en-US", body!.Language);

        var paragraph = Assert.Single(body.Paragraphs);
        Assert.Equal("b1:0", paragraph.Id);

        var issue = Assert.Single(paragraph.Issues);
        Assert.Equal("jumpd", issue.Text);
        Assert.Equal(text.IndexOf("jumpd", StringComparison.Ordinal), issue.Start);
        Assert.Equal(issue.Start + 5, issue.End);
        Assert.Equal("spelling", issue.Kind);
        Assert.Equal("error", issue.Tone);
        Assert.Null(issue.Fixes);
    }

    [Fact]
    public async Task TheWireUsesCamelCaseAndSpellsAnAbsentFieldAsNull()
    {
        // The client is written against these exact names. An issue with nothing to say still carries
        // the optional fields as null rather than dropping them, so a reader can use them unguarded.
        await using var host = await new ProofingHttpHarness().StartAsync();

        var response = await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(("a", "a speling mistake")));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        var root = json.RootElement;
        Assert.Equal("en-US", root.GetProperty("language").GetString());

        var issue = root.GetProperty("paragraphs")[0].GetProperty("issues")[0];
        foreach (var name in new[] { "start", "end", "text", "kind", "tone" })
            Assert.True(issue.TryGetProperty(name, out _), $"The wire is missing '{name}'.");

        foreach (var name in new[] { "ruleId", "titleKey", "messageKey", "fixes" })
            Assert.Equal(JsonValueKind.Null, issue.GetProperty(name).ValueKind);
    }

    [Fact]
    public async Task TheStatusWireUsesTheNamesTheClientReads()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        // A check waits for the word list, so after one the language is genuinely loaded. Asking for
        // status first would report "loading", which is the honest answer while the read is in flight.
        await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(("a", "ok")));

        using var json = JsonDocument.Parse(await host.Client.GetStringAsync("/api/proofing/status"));
        var root = json.RootElement;

        foreach (var name in new[] { "enabled", "language", "languages", "personalWordCount" })
            Assert.True(root.TryGetProperty(name, out _), $"The status wire is missing '{name}'.");

        var english = root.GetProperty("languages").EnumerateArray()
            .Single(l => l.GetProperty("id").GetString() == "en-US");
        foreach (var name in new[] { "id", "name", "region", "installed", "bundled", "state", "reasonKey", "license" })
            Assert.True(english.TryGetProperty(name, out _), $"The status wire is missing '{name}'.");

        Assert.Equal("ready", english.GetProperty("state").GetString());
        Assert.True(english.GetProperty("license").TryGetProperty("name", out _));
        Assert.True(english.GetProperty("license").TryGetProperty("url", out _));
    }

    [Fact]
    public async Task EveryParagraphComesBackEvenWhenItIsClean()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var response = await host.Client.PostAsJsonAsync(
            "/api/proofing/check",
            Paragraphs(("a", "The fox jumped."), ("b", "A speling mistake.")));
        var body = await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();

        Assert.Equal(["a", "b"], body!.Paragraphs.Select(p => p.Id));
        Assert.Empty(body.Paragraphs[0].Issues);
        Assert.Equal("speling", Assert.Single(body.Paragraphs[1].Issues).Text);
    }

    [Fact]
    public async Task TooManyParagraphsIs413()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        var items = Enumerable.Range(0, ProofingEndpoints.MaxParagraphs + 1)
            .Select(i => ($"p{i}", "ok")).ToArray();

        var response = await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(items));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorDto>();
        Assert.Equal("proofing_batch_too_large", error!.Error);
    }

    [Fact]
    public async Task TooMuchTextIs413()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        var body = new string('a', (ProofingEndpoints.MaxCharacters / 2) + 1);

        var response = await host.Client.PostAsJsonAsync(
            "/api/proofing/check",
            Paragraphs(("a", body), ("b", body)));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task ABatchAtTheParagraphLimitIsAccepted()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        var items = Enumerable.Range(0, ProofingEndpoints.MaxParagraphs)
            .Select(i => ($"p{i}", "ok")).ToArray();

        var response = await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(items));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task ADictionaryStillLoadingIs503WithAnErrorBody()
    {
        await using var host = await new ProofingHttpHarness(
            new ProofingHttpHarness.NeverReadyEngine(),
            TimeSpan.FromMilliseconds(200)).StartAsync();

        var response = await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(("a", "anything")));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ErrorDto>();
        Assert.Equal("proofing_loading", error!.Error);
    }

    [Fact]
    public async Task SuggestAnswersForARangeAndIsCapped()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        const string text = "The fox jumpd over it.";

        var response = await host.Client.PostAsJsonAsync("/api/proofing/suggest", new
        {
            language = "en-US",
            text,
            start = text.IndexOf("jumpd", StringComparison.Ordinal),
            end = text.IndexOf("jumpd", StringComparison.Ordinal) + 5,
        });
        var body = await response.Content.ReadFromJsonAsync<ProofingSuggestResponseDto>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEmpty(body!.Suggestions);
        Assert.True(body.Suggestions.Count <= 8);
        Assert.Contains(body.Suggestions, s => s.Replacement == "jumped");
    }

    [Fact]
    public async Task ASuggestRangeThatSplitsASurrogatePairIs400RatherThan500()
    {
        // The offsets come from an earlier check while the text is current, so an edit in between can
        // leave them pointing inside an astral character. Each of these answered 500 before.
        await using var host = await new ProofingHttpHarness().StartAsync();
        const string text = "\U0001F600speling";

        foreach (var (start, end) in new[] { (1, 4), (1, 9), (0, 1) })
        {
            var response = await host.Client.PostAsJsonAsync(
                "/api/proofing/suggest",
                new { language = "en-US", text, start, end });

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("proofing_range_invalid", (await response.Content.ReadFromJsonAsync<ErrorDto>())!.Error);
        }
    }

    [Fact]
    public async Task ASuggestRangeAlignedAfterAnEmojiStillAnswers()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        const string text = "\U0001F600speling";

        var response = await host.Client.PostAsJsonAsync(
            "/api/proofing/suggest",
            new { language = "en-US", text, start = 2, end = 9 });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEmpty((await response.Content.ReadFromJsonAsync<ProofingSuggestResponseDto>())!.Suggestions);
    }

    [Fact]
    public async Task AParagraphIdLongerThanTheCapIs400AndIdsCountTowardTheCharacterBound()
    {
        // The bound counted text only, so ids were an unbounded channel and were echoed back verbatim.
        await using var host = await new ProofingHttpHarness().StartAsync();

        var longId = await host.Client.PostAsJsonAsync(
            "/api/proofing/check",
            Paragraphs((new string('a', ProofingEndpoints.MaxParagraphIdLength + 1), "ok")));
        Assert.Equal(HttpStatusCode.BadRequest, longId.StatusCode);
        Assert.Equal("proofing_paragraph_invalid", (await longId.Content.ReadFromJsonAsync<ErrorDto>())!.Error);

        var atCap = await host.Client.PostAsJsonAsync(
            "/api/proofing/check",
            Paragraphs((new string('a', ProofingEndpoints.MaxParagraphIdLength), "ok")));
        Assert.Equal(HttpStatusCode.OK, atCap.StatusCode);

        // Ids plus text now share the one budget, so a batch that is under the bound on text alone
        // still trips it.
        var body = new string('a', (ProofingEndpoints.MaxCharacters / 2) - 4);
        var both = await host.Client.PostAsJsonAsync(
            "/api/proofing/check",
            Paragraphs(("aaaaaaaa", body), ("bbbbbbbb", body)));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, both.StatusCode);
    }

    [Fact]
    public async Task APersonalWordStopsBeingReported()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var added = await host.Client.PostAsJsonAsync("/api/proofing/personal", new { word = "Ordbanken" });
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);

        var listed = await added.Content.ReadFromJsonAsync<ProofingPersonalWordsDto>();
        var word = Assert.Single(listed!.Words);
        Assert.Equal("Ordbanken", word.Word);
        Assert.Null(word.Language);
        Assert.True(DateTimeOffset.TryParse(word.AddedAt, out _));

        var check = await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(("a", "The Ordbanken entry.")));
        var body = await check.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();
        Assert.Empty(body!.Paragraphs[0].Issues);

        var removed = await host.Client.PostAsJsonAsync("/api/proofing/personal/remove", new { word = "ordbanken" });
        Assert.Empty((await removed.Content.ReadFromJsonAsync<ProofingPersonalWordsDto>())!.Words);
    }

    [Fact]
    public async Task AWordWithAnAccentAndAnApostropheRoundTripsThroughTheRemoveBody()
    {
        // The reason removal is a POST body rather than a route segment: these characters are exactly
        // the ones a dictionary lacks, and exactly the ones a path segment mangles.
        await using var host = await new ProofingHttpHarness().StartAsync();
        const string word = "Bj\u00F8rn's";

        await host.Client.PostAsJsonAsync("/api/proofing/personal", new { word });
        var removed = await host.Client.PostAsJsonAsync("/api/proofing/personal/remove", new { word });

        Assert.Empty((await removed.Content.ReadFromJsonAsync<ProofingPersonalWordsDto>())!.Words);
    }

    [Fact]
    public async Task AnEmptyWordIs400()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var response = await host.Client.PostAsJsonAsync("/api/proofing/personal", new { word = "  " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("proofing_word_required", (await response.Content.ReadFromJsonAsync<ErrorDto>())!.Error);
    }

    [Fact]
    public async Task ANoteIgnoreOnlyAppliesToThatNote()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var added = await host.Client.PostAsJsonAsync(IgnoresUrl(NoteA), new { word = "speling" });
        Assert.Equal(["speling"], (await added.Content.ReadFromJsonAsync<ProofingNoteIgnoresDto>())!.Words);

        var inNote = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            noteId = NoteA,
            paragraphs = new[] { new { id = "a", text = "a speling mistake" } },
        });
        Assert.Empty((await inNote.Content.ReadFromJsonAsync<ProofingCheckResponseDto>())!.Paragraphs[0].Issues);

        var elsewhere = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            noteId = NoteB,
            paragraphs = new[] { new { id = "a", text = "a speling mistake" } },
        });
        Assert.Single((await elsewhere.Content.ReadFromJsonAsync<ProofingCheckResponseDto>())!.Paragraphs[0].Issues);

        var listed = await host.Client.GetFromJsonAsync<ProofingNoteIgnoresDto>(IgnoresUrl(NoteA));
        Assert.Equal(["speling"], listed!.Words);

        var removed = await host.Client.PostAsJsonAsync(IgnoresUrl(NoteA) + "/remove", new { word = "speling" });
        Assert.Empty((await removed.Content.ReadFromJsonAsync<ProofingNoteIgnoresDto>())!.Words);
    }

    [Fact]
    public async Task ANoteThatIsFullRefusesAnotherWordWith409()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        for (var i = 0; i < 200; i++)
            await host.Client.PostAsJsonAsync(IgnoresUrl(NoteFull), new { word = $"word{i}" });

        var response = await host.Client.PostAsJsonAsync(IgnoresUrl(NoteFull), new { word = "onemore" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("proofing_ignore_limit", (await response.Content.ReadFromJsonAsync<ErrorDto>())!.Error);
    }

    [Fact]
    public async Task ANullParagraphEntryIs400RatherThanAnInternalError()
    {
        // A JSON null in the array binds to a null entry, and reading through one used to escape the
        // handler as a NullReferenceException, which the host reports as an internal error.
        await using var host = await new ProofingHttpHarness().StartAsync();

        foreach (var payload in new[]
                 {
                     """{"paragraphs":[null]}""",
                     """{"paragraphs":[{"id":"a","text":"ok"},null]}""",
                 })
        {
            var response = await host.Client.PostAsync(
                "/api/proofing/check",
                new StringContent(payload, Encoding.UTF8, "application/json"));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("proofing_paragraph_invalid", (await response.Content.ReadFromJsonAsync<ErrorDto>())!.Error);
        }
    }

    [Fact]
    public async Task AParagraphWithNoIdIs400()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        foreach (var payload in new[]
                 {
                     """{"paragraphs":[{"text":"ok"}]}""",
                     """{"paragraphs":[{"id":"","text":"ok"}]}""",
                 })
        {
            var response = await host.Client.PostAsync(
                "/api/proofing/check",
                new StringContent(payload, Encoding.UTF8, "application/json"));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
    }

    [Fact]
    public async Task AnEmptyBatchIsAcceptedAndAnswersWithNoParagraphs()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var response = await host.Client.PostAsync(
            "/api/proofing/check",
            new StringContent("""{"paragraphs":[]}""", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>())!.Paragraphs);
    }

    [Fact]
    public async Task AWordLongerThanTheCapIs400()
    {
        // Both stores are one settings value rewritten in full per write, so an unbounded word is an
        // unbounded row.
        await using var host = await new ProofingHttpHarness().StartAsync();
        var tooLong = new string('a', ProofingEndpoints.MaxWordLength + 1);

        foreach (var url in new[] { "/api/proofing/personal", "/api/proofing/personal/remove" })
        {
            var response = await host.Client.PostAsJsonAsync(url, new { word = tooLong });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("proofing_word_too_long", (await response.Content.ReadFromJsonAsync<ErrorDto>())!.Error);
        }

        var ignore = await host.Client.PostAsJsonAsync(IgnoresUrl(NoteA), new { word = tooLong });
        Assert.Equal(HttpStatusCode.BadRequest, ignore.StatusCode);

        var atCap = await host.Client.PostAsJsonAsync(
            "/api/proofing/personal",
            new { word = new string('a', ProofingEndpoints.MaxWordLength) });
        Assert.Equal(HttpStatusCode.OK, atCap.StatusCode);
    }

    [Fact]
    public async Task ANoteIdThatIsNotAGuidIs400OnEveryIgnoresRoute()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        foreach (var noteId in new[] { "not-a-guid", "..%2F..%2Fetc", new string('x', 4000) })
        {
            var listed = await host.Client.GetAsync(IgnoresUrl(noteId));
            Assert.Equal(HttpStatusCode.BadRequest, listed.StatusCode);
            Assert.Equal("proofing_note_invalid", (await listed.Content.ReadFromJsonAsync<ErrorDto>())!.Error);

            var added = await host.Client.PostAsJsonAsync(IgnoresUrl(noteId), new { word = "speling" });
            Assert.Equal(HttpStatusCode.BadRequest, added.StatusCode);

            var removed = await host.Client.PostAsJsonAsync(IgnoresUrl(noteId) + "/remove", new { word = "speling" });
            Assert.Equal(HttpStatusCode.BadRequest, removed.StatusCode);
        }
    }

    [Fact]
    public async Task ARequestNamingAnUninstalledLanguageFallsBackToTheEffectiveOne()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var response = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            language = "de-DE",
            paragraphs = new[] { new { id = "a", text = "a speling mistake" } },
        });
        var body = await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();

        Assert.Equal("en-US", body!.Language);
        Assert.Single(body.Paragraphs[0].Issues);
    }
}
