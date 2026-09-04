using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
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

    private static string LanguagesUrl(string noteId) => $"/api/proofing/notes/{noteId}/languages";

    [Fact]
    public async Task StatusAnswersWithEnglishReadyOnACleanProfile()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        Assert.NotNull(status);
        Assert.True(status.Enabled);
        Assert.Equal(["en-US"], status.Active);
        Assert.Null(status.Note);
        Assert.Equal(0, status.PersonalWordCount);

        var english = status.Languages.Single(l => l.Id == "en-US");
        Assert.True(english.Installed);
        Assert.True(english.Bundled);
        Assert.False(string.IsNullOrWhiteSpace(english.License.Name));

        foreach (var id in new[] { "de-DE", "nb-NO", "ja-JP" })
        {
            var absent = status.Languages.Single(l => l.Id == id);
            Assert.False(absent.Installed);
            Assert.Equal("absent", absent.State);
            Assert.False(string.IsNullOrWhiteSpace(absent.ReasonKey));
        }
    }

    [Fact]
    public async Task JapaneseIsListedLastAsAbsentWithAnIdTheClientCanRecognise()
    {
        // The settings page picks Japanese out by an id prefix, so the tag has to start with "ja". It
        // is listed after the two that are merely unbundled because it is a different answer: no
        // Hunspell dictionary for Japanese exists in any distribution, and none is coming.
        await using var host = await new ProofingHttpHarness().StartAsync();

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        var absent = status!.Languages.Where(l => !l.Installed).Select(l => l.Id).ToArray();
        Assert.Equal(["de-DE", "nb-NO", "ja-JP"], absent);

        var japanese = status.Languages.Single(l => l.Id == "ja-JP");
        Assert.StartsWith("ja", japanese.Id, StringComparison.OrdinalIgnoreCase);
        Assert.False(japanese.Installed);
        Assert.False(japanese.Bundled);
        Assert.Equal("absent", japanese.State);
        Assert.Equal("proofing.language.unsupportedByEngine", japanese.ReasonKey);
        Assert.Equal("Japanese", japanese.Name);
        Assert.Equal("Japan", japanese.Region);
    }

    [Fact]
    public async Task JapaneseIsNeverResolvedAndCannotBeStored()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        // Even with the older editor setting naming it, the effective set falls through.
        host.Settings.Seed(ProofingService.LegacyLanguageKey, "ja");
        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");
        Assert.Equal(["en-US"], status!.Active);

        // And a check that asks for it answers in the effective set rather than emptily.
        var check = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            languages = new[] { "ja-JP" },
            paragraphs = new[] { new { id = "a", text = "a speling mistake" } },
        });
        var body = await check.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();
        Assert.Equal(["en-US"], body!.Languages);
        Assert.Single(body.Paragraphs[0].Issues);
    }

    [Fact]
    public async Task TheEffectiveLanguageComesFromTheOlderEditorSettingWhenNothingElseIsStored()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LegacyLanguageKey, "es");

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        Assert.Equal(["es-ES"], status!.Active);
    }

    [Fact]
    public async Task AnOlderEditorLanguageWithNoDictionaryResolvesToEnglish()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LegacyLanguageKey, "nb");

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        Assert.Equal(["en-US"], status!.Active);
    }

    [Fact]
    public async Task TheStoredSetIsTheOneTheHostChecksIn()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LanguagesKey, new[] { "es-ES", "en-US" });

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");

        Assert.Equal(["es-ES", "en-US"], status!.Active);
    }

    [Fact]
    public async Task SwitchingEveryLanguageOffLeavesNothingChecked()
    {
        // The settings page stores an empty list when the last language is removed, and it has an
        // empty state to render. Resolving a default here would put that language straight back.
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LanguagesKey, Array.Empty<string>());

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>("/api/proofing/status");
        Assert.Empty(status!.Active);

        var check = await host.Client.PostAsJsonAsync(
            "/api/proofing/check",
            Paragraphs(("a", "a speling mistake")));
        var body = await check.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();
        Assert.Empty(body!.Languages);
        Assert.Empty(body.Paragraphs[0].Issues);
    }

    [Fact]
    public async Task ACheckReturnsOffsetsIntoTheParagraphItWasSent()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        const string text = "\U0001F389 The fox jumpd over it.";

        var response = await host.Client.PostAsJsonAsync("/api/proofing/check", Paragraphs(("b1:0", text)));
        var body = await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(["en-US"], body!.Languages);

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
        Assert.Equal(
            ["en-US"],
            root.GetProperty("languages").EnumerateArray().Select(l => l.GetString()));

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

        foreach (var name in new[] { "enabled", "active", "languages", "personalWordCount", "note" })
            Assert.True(root.TryGetProperty(name, out _), $"The status wire is missing '{name}'.");

        Assert.Equal(JsonValueKind.Null, root.GetProperty("note").ValueKind);

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
            languages = new[] { "en-US" },
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
                new { languages = new[] { "en-US" }, text, start, end });

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
            new { languages = new[] { "en-US" }, text, start = 2, end = 9 });

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
            languages = new[] { "de-DE" },
            paragraphs = new[] { new { id = "a", text = "a speling mistake" } },
        });
        var body = await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();

        Assert.Equal(["en-US"], body!.Languages);
        Assert.Single(body.Paragraphs[0].Issues);
    }

    [Fact]
    public async Task AWordEitherLanguageKnowsIsNotAMistake()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LanguagesKey, new[] { "en-US", "es-ES" });

        var response = await host.Client.PostAsJsonAsync(
            "/api/proofing/check",
            Paragraphs(("a", "The palabra speling here")));
        var body = await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();

        Assert.Equal(["en-US", "es-ES"], body!.Languages);
        Assert.Equal("speling", Assert.Single(body.Paragraphs[0].Issues).Text);
    }

    [Fact]
    public async Task AClientMayNarrowTheSetButNotReachOutsideIt()
    {
        // The editor checks with the dictionaries it has watched become ready while another is
        // still loading, and the answer names the set that was used so a stale one can be dropped.
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LanguagesKey, new[] { "en-US", "es-ES" });

        var narrowed = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            languages = new[] { "EN-us" },
            paragraphs = new[] { new { id = "a", text = "The palabra speling here" } },
        });
        var byEnglish = await narrowed.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();
        Assert.Equal(["en-US"], byEnglish!.Languages);
        Assert.Equal(["palabra", "speling"], byEnglish.Paragraphs[0].Issues.Select(i => i.Text));

        var reaching = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            languages = new[] { "en-US", "de-DE" },
            paragraphs = new[] { new { id = "a", text = "The palabra speling here" } },
        });
        var byBoth = await reaching.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();
        Assert.Equal(["en-US", "es-ES"], byBoth!.Languages);
    }

    [Fact]
    public async Task AnHonouredHintIsEchoedExactlyAsItWasSent()
    {
        // The client keeps one identity per scheduler, the languages it sent joined by commas, and
        // compares the answer to it character for character. Anything reordered or recased there
        // makes every batch look like it belongs to a set the client is no longer using.
        await using var host = await new ProofingHttpHarness().StartAsync();
        host.Settings.Seed(ProofingService.LanguagesKey, new[] { "en-US", "es-ES" });

        foreach (var hint in new[] { new[] { "es-ES", "en-US" }, ["en-US"], ["es-ES"] })
        {
            var response = await host.Client.PostAsJsonAsync("/api/proofing/check", new
            {
                languages = hint,
                paragraphs = new[] { new { id = "a", text = "ok" } },
            });
            var body = await response.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();

            Assert.Equal(hint, body!.Languages);
        }

        // And a hint that names the same languages in another spelling comes back in the catalog's.
        var recased = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            languages = new[] { "ES-es", "en-us" },
            paragraphs = new[] { new { id = "a", text = "ok" } },
        });
        Assert.Equal(
            ["es-ES", "en-US"],
            (await recased.Content.ReadFromJsonAsync<ProofingCheckResponseDto>())!.Languages);
    }

    [Fact]
    public async Task TheNoteWireUsesTheNamesTheClientReads()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        var note = Guid.NewGuid().ToString();
        await host.Client.PutAsJsonAsync(LanguagesUrl(note), new { mode = "custom", languages = new[] { "es-ES" } });

        using var json = JsonDocument.Parse(await host.Client.GetStringAsync($"/api/proofing/status?noteId={note}"));
        var stored = json.RootElement.GetProperty("note");

        foreach (var name in new[] { "mode", "languages", "effective" })
            Assert.True(stored.TryGetProperty(name, out _), $"The note wire is missing '{name}'.");

        Assert.Equal("custom", stored.GetProperty("mode").GetString());
        Assert.Equal(
            ["es-ES"],
            stored.GetProperty("effective").EnumerateArray().Select(l => l.GetString()));
    }

    [Fact]
    public async Task StatusCarriesTheNoteItWasAskedAbout()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var status = await host.Client.GetFromJsonAsync<ProofingStatusDto>($"/api/proofing/status?noteId={NoteA}");

        Assert.Equal(["en-US"], status!.Active);
        Assert.Equal("default", status.Note!.Mode);
        Assert.Empty(status.Note.Languages);
        Assert.Equal(["en-US"], status.Note.Effective);
    }

    [Fact]
    public async Task ANoteCanBeCheckedInItsOwnLanguages()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        var note = Guid.NewGuid().ToString();

        var written = await host.Client.PutAsJsonAsync(
            LanguagesUrl(note),
            new { mode = "custom", languages = new[] { "ES-es" } });
        var stored = await written.Content.ReadFromJsonAsync<NoteProofingDto>();
        Assert.Equal(HttpStatusCode.OK, written.StatusCode);
        Assert.Equal("custom", stored!.Mode);
        Assert.Equal(["es-ES"], stored.Languages);
        Assert.Equal(["es-ES"], stored.Effective);

        var read = await host.Client.GetFromJsonAsync<NoteProofingDto>(LanguagesUrl(note));
        Assert.Equal(["es-ES"], read!.Effective);

        // The note's own set is what a check runs in, whatever settings say.
        var check = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            noteId = note,
            paragraphs = new[] { new { id = "a", text = "The palabra speling here" } },
        });
        var body = await check.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();
        Assert.Equal(["es-ES"], body!.Languages);
        Assert.DoesNotContain(body.Paragraphs[0].Issues, i => i.Text == "palabra");
    }

    [Fact]
    public async Task ANoteCanBeSwitchedOffAndBackOntoTheDefaults()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        var note = Guid.NewGuid().ToString();
        await host.Client.PutAsJsonAsync(LanguagesUrl(note), new { mode = "custom", languages = new[] { "es-ES" } });

        var off = await host.Client.PutAsJsonAsync(LanguagesUrl(note), new { mode = "off" });
        var stored = await off.Content.ReadFromJsonAsync<NoteProofingDto>();
        Assert.Equal("off", stored!.Mode);
        Assert.Empty(stored.Languages);
        Assert.Empty(stored.Effective);

        var check = await host.Client.PostAsJsonAsync("/api/proofing/check", new
        {
            noteId = note,
            paragraphs = new[] { new { id = "a", text = "a speling mistake" } },
        });
        var body = await check.Content.ReadFromJsonAsync<ProofingCheckResponseDto>();
        Assert.Empty(body!.Languages);
        Assert.Empty(body.Paragraphs[0].Issues);

        var back = await host.Client.PutAsJsonAsync(LanguagesUrl(note), new { mode = "default" });
        var followed = await back.Content.ReadFromJsonAsync<NoteProofingDto>();
        Assert.Equal("default", followed!.Mode);
        Assert.Equal(["en-US"], followed.Effective);
    }

    [Fact]
    public async Task ANoteThatWasNeverGivenLanguagesFollowsTheDefaults()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        var read = await host.Client.GetFromJsonAsync<NoteProofingDto>(LanguagesUrl(Guid.NewGuid().ToString()));

        Assert.Equal("default", read!.Mode);
        Assert.Empty(read.Languages);
        Assert.Equal(["en-US"], read.Effective);
    }

    [Fact]
    public async Task ARefusedNoteLanguageWriteSaysWhich()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();
        var note = Guid.NewGuid().ToString();

        foreach (var (body, code) in new (object Body, string Code)[]
                 {
                     (new { mode = "sometimes" }, "proofing_mode_invalid"),
                     (new { mode = "custom" }, "proofing_language_required"),
                     (new { mode = "custom", languages = Array.Empty<string>() }, "proofing_language_required"),
                     (new { mode = "custom", languages = new[] { "qq-QQ" } }, "proofing_language_unknown"),
                     (new { mode = "custom", languages = new[] { "en-US", "" } }, "proofing_language_unknown"),
                 })
        {
            var response = await host.Client.PutAsJsonAsync(LanguagesUrl(note), body);

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(code, (await response.Content.ReadFromJsonAsync<ErrorDto>())!.Error);
        }

        // A refusal stores nothing, so the note is still on the defaults.
        var read = await host.Client.GetFromJsonAsync<NoteProofingDto>(LanguagesUrl(note));
        Assert.Equal("default", read!.Mode);
    }

    [Fact]
    public async Task ALanguageWithNoDictionaryYetIsStoredAndFilteredOutOnTheWayBack()
    {
        // The picker can hold a language a later build will ship. Resolution drops it, the store
        // keeps it, so switching one on the day it arrives needs no repair pass.
        await using var host = await new ProofingHttpHarness().StartAsync();
        var note = Guid.NewGuid().ToString();

        var written = await host.Client.PutAsJsonAsync(
            LanguagesUrl(note),
            new { mode = "custom", languages = new[] { "en-US", "de-DE" } });
        var stored = await written.Content.ReadFromJsonAsync<NoteProofingDto>();

        Assert.Equal(["en-US", "de-DE"], stored!.Languages);
        Assert.Equal(["en-US"], stored.Effective);
    }

    [Fact]
    public async Task ANoteBeyondTheMapCapIs409()
    {
        // Seeded rather than written five hundred times, which also pins the stored shape: the
        // service reads the map back as the type it writes, and a mismatch reads as an empty map.
        await using var host = await new ProofingHttpHarness().StartAsync();
        var stored = Enumerable.Range(0, 500).Select(_ => Guid.NewGuid().ToString()).ToArray();
        host.Settings.Seed(
            NoteLanguageService.StorageKey,
            stored.ToDictionary(id => id, _ => new NoteLanguageEntry("custom", ["en-US"]), StringComparer.Ordinal));

        var response = await host.Client.PutAsJsonAsync(
            LanguagesUrl(Guid.NewGuid().ToString()),
            new { mode = "custom", languages = new[] { "es-ES" } });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("proofing_note_language_limit", (await response.Content.ReadFromJsonAsync<ErrorDto>())!.Error);

        // A note already in the map cannot grow it, so it can still be rewritten and cleared.
        var existing = await host.Client.PutAsJsonAsync(
            LanguagesUrl(stored[0]),
            new { mode = "custom", languages = new[] { "es-ES" } });
        Assert.Equal(HttpStatusCode.OK, existing.StatusCode);
        Assert.Equal(["es-ES"], (await existing.Content.ReadFromJsonAsync<NoteProofingDto>())!.Languages);

        var cleared = await host.Client.PutAsJsonAsync(LanguagesUrl(stored[1]), new { mode = "default" });
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);

        // And clearing one made room for a new note.
        var admitted = await host.Client.PutAsJsonAsync(
            LanguagesUrl(Guid.NewGuid().ToString()),
            new { mode = "custom", languages = new[] { "es-ES" } });
        Assert.Equal(HttpStatusCode.OK, admitted.StatusCode);
    }

    [Fact]
    public async Task ANoteIdThatIsNotAGuidIs400OnEveryRouteThatTakesOne()
    {
        // The note id now selects which languages a request runs in, so an unchecked one is a way
        // to be checked in something nobody chose.
        await using var host = await new ProofingHttpHarness().StartAsync();

        foreach (var noteId in new[] { "not-a-guid", "..%2F..%2Fetc" })
        {
            var status = await host.Client.GetAsync($"/api/proofing/status?noteId={noteId}");
            Assert.Equal(HttpStatusCode.BadRequest, status.StatusCode);
            Assert.Equal("proofing_note_invalid", (await status.Content.ReadFromJsonAsync<ErrorDto>())!.Error);

            var check = await host.Client.PostAsJsonAsync("/api/proofing/check", new
            {
                noteId,
                paragraphs = new[] { new { id = "a", text = "ok" } },
            });
            Assert.Equal(HttpStatusCode.BadRequest, check.StatusCode);

            var suggest = await host.Client.PostAsJsonAsync("/api/proofing/suggest", new
            {
                noteId,
                text = "speling",
                start = 0,
                end = 7,
            });
            Assert.Equal(HttpStatusCode.BadRequest, suggest.StatusCode);

            var read = await host.Client.GetAsync(LanguagesUrl(noteId));
            Assert.Equal(HttpStatusCode.BadRequest, read.StatusCode);

            var written = await host.Client.PutAsJsonAsync(LanguagesUrl(noteId), new { mode = "default" });
            Assert.Equal(HttpStatusCode.BadRequest, written.StatusCode);
        }
    }

    [Fact]
    public async Task StatusWithNoNoteNamedIsStillAnswered()
    {
        await using var host = await new ProofingHttpHarness().StartAsync();

        foreach (var url in new[] { "/api/proofing/status", "/api/proofing/status?noteId=" })
        {
            var response = await host.Client.GetAsync(url);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Null((await response.Content.ReadFromJsonAsync<ProofingStatusDto>())!.Note);
        }
    }
}
