using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

public sealed class ProofingServiceTests
{
    private static readonly string[] English = ["en-US"];
    private static readonly string[] Spanish = ["es-ES"];
    private static readonly string[] Both = ["en-US", "es-ES"];

    private static (ProofingService Service, MemorySettings Settings, PersonalDictionaryService Personal,
        NoteIgnoreService Ignores, NoteLanguageService NoteLanguages, StubProofingEngine Engine)
        Build(params string[] flagged)
    {
        var settings = new MemorySettings();
        var personal = new PersonalDictionaryService(settings);
        var ignores = new NoteIgnoreService(settings);
        var noteLanguages = new NoteLanguageService(settings);
        var engine = new StubProofingEngine(Both, flagged);
        var service = new ProofingService(
            new ProofingEngineRegistry([engine]),
            new ProofingDictionaryCatalog(),
            personal,
            ignores,
            noteLanguages,
            settings);

        return (service, settings, personal, ignores, noteLanguages, engine);
    }

    private static ProofingService BuildWith(params IProofingEngine[] engines)
    {
        var settings = new MemorySettings();
        return new ProofingService(
            new ProofingEngineRegistry(engines),
            new ProofingDictionaryCatalog(),
            new PersonalDictionaryService(settings),
            new NoteIgnoreService(settings),
            new NoteLanguageService(settings),
            settings);
    }

    [Fact]
    public async Task AWordInThePersonalDictionaryIsNotReported()
    {
        var (service, _, personal, _, _, _) = Build("Ordbanken", "myocyte");

        var before = await service.CheckAsync(English, null, "Ordbanken and myocyte", CancellationToken.None);
        Assert.Equal(2, before.Count);

        await personal.AddAsync("ordbanken", null, CancellationToken.None);

        var after = await service.CheckAsync(English, null, "Ordbanken and myocyte", CancellationToken.None);
        Assert.Equal("myocyte", Assert.Single(after).Text);
    }

    [Fact]
    public async Task AWordVouchedForInOneCheckedLanguageIsAcceptedInTheOthers()
    {
        var (service, _, personal, _, _, _) = Build("Ordbanken");
        await personal.AddAsync("Ordbanken", "es-ES", CancellationToken.None);

        Assert.Single(await service.CheckAsync(English, null, "the Ordbanken entry", CancellationToken.None));
        Assert.Empty(await service.CheckAsync(Both, null, "the Ordbanken entry", CancellationToken.None));
    }

    [Fact]
    public async Task AWordIgnoredInOneNoteIsStillReportedInAnother()
    {
        var (service, _, _, ignores, _, _) = Build("myocyte");
        await ignores.AddAsync("note-a", "MYOCYTE", CancellationToken.None);

        Assert.Empty(await service.CheckAsync(English, "note-a", "the myocyte", CancellationToken.None));
        Assert.Single(await service.CheckAsync(English, "note-b", "the myocyte", CancellationToken.None));
        Assert.Single(await service.CheckAsync(English, null, "the myocyte", CancellationToken.None));
    }

    [Fact]
    public async Task IssuesComeBackInDocumentOrder()
    {
        var (service, _, _, _, _, _) = Build("zeta", "alpha");

        var issues = await service.CheckAsync(English, null, "alpha then zeta", CancellationToken.None);

        Assert.Equal(["alpha", "zeta"], issues.Select(i => i.Text));
    }

    [Fact]
    public async Task ALanguageNoEngineServesReportsNothing()
    {
        var (service, _, _, _, _, _) = Build("myocyte");

        Assert.Empty(await service.CheckAsync(["de-DE"], null, "the myocyte", CancellationToken.None));
        Assert.Empty(await service.CheckAsync([], null, "the myocyte", CancellationToken.None));
    }

    [Fact]
    public async Task AWordIsOnlyAMistakeWhenEveryLanguageSaysSo()
    {
        var (service, _, _, _, _, engine) = Build();
        engine.FlaggedFor["en-US"] = ["hola", "myocyte"];
        engine.FlaggedFor["es-ES"] = ["myocyte"];

        var one = await service.CheckAsync(English, null, "hola myocyte", CancellationToken.None);
        Assert.Equal(["hola", "myocyte"], one.Select(i => i.Text));

        var both = await service.CheckAsync(Both, null, "hola myocyte", CancellationToken.None);
        Assert.Equal("myocyte", Assert.Single(both).Text);
    }

    [Fact]
    public async Task ALanguageWhoseWordListCouldNotBeReadDoesNotEmptyTheIntersection()
    {
        // A failed read answers with no issues, which is indistinguishable from a clean paragraph.
        // Counting it would turn one broken dictionary into spell checking that is quietly off.
        var (service, _, _, _, _, engine) = Build("myocyte");
        engine.Unreadable.Add("es-ES");

        var issues = await service.CheckAsync(Both, null, "the myocyte", CancellationToken.None);

        Assert.Equal("myocyte", Assert.Single(issues).Text);
    }

    [Fact]
    public async Task EveryLanguageFailingReportsNothing()
    {
        var (service, _, _, _, _, engine) = Build("myocyte");
        engine.Unreadable.Add("en-US");
        engine.Unreadable.Add("es-ES");

        Assert.Empty(await service.CheckAsync(Both, null, "the myocyte", CancellationToken.None));
    }

    [Fact]
    public async Task AnIssueOfAnotherKindSurvivesFromASingleLanguage()
    {
        // Spelling is the only kind a second dictionary can overrule. A grammar issue is about a
        // stretch of writing rather than a word, so intersecting would delete all of them.
        var spelling = new StubProofingEngine(Both);
        spelling.FlaggedFor["en-US"] = ["myocyte"];
        spelling.FlaggedFor["es-ES"] = [];
        var grammar = new StubProofingEngine(English, "myocyte") { Kind = "grammar" };
        var service = BuildWith(spelling, grammar);

        var issues = await service.CheckAsync(Both, null, "the myocyte", CancellationToken.None);

        var issue = Assert.Single(issues);
        Assert.Equal("grammar", issue.Kind);
    }

    [Fact]
    public async Task TheSameOtherKindIssueFromTwoLanguagesIsReportedOnce()
    {
        var grammar = new StubProofingEngine(Both, "myocyte") { Kind = "grammar" };
        var service = BuildWith(grammar);

        var issues = await service.CheckAsync(Both, null, "the myocyte", CancellationToken.None);

        Assert.Equal("grammar", Assert.Single(issues).Kind);
    }

    [Fact]
    public async Task TheStoredSetWinsWhenItsDictionariesAreInstalled()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguagesKey, new[] { "es-ES", "en-US" });

        Assert.Equal(["es-ES", "en-US"], await service.ResolveActiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task TheStoredSetIsCanonicalisedDeduplicatedAndFilteredToInstalled()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguagesKey, new[] { "EN-us", "de-DE", "en-US" });

        Assert.Equal(["en-US"], await service.ResolveActiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AStoredEmptySetMeansNothingIsChecked()
    {
        // Switching the last language off is a choice. Falling back here would hand back the
        // language the user just removed, and the settings page could never show its empty state.
        var (service, settings, _, _, _, _) = Build("myocyte");
        await settings.SetAsync(ProofingService.LanguageKey, "es-ES");
        await settings.SetAsync(ProofingService.LanguagesKey, Array.Empty<string>());

        var active = await service.ResolveActiveAsync(CancellationToken.None);

        Assert.Empty(active);
        Assert.Empty(await service.CheckAsync(active, null, "the myocyte", CancellationToken.None));
    }

    [Fact]
    public async Task AStoredSetWithNothingInstalledMeansNothingIsChecked()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguagesKey, new[] { "de-DE" });
        await settings.SetAsync(ProofingService.LanguageKey, "es-ES");

        Assert.Empty(await service.ResolveActiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ANoteFollowingTheDefaultsIsCheckedInNothingWhenTheSetIsEmpty()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguagesKey, Array.Empty<string>());

        var note = await service.ResolveForNoteAsync("note-a", CancellationToken.None);

        Assert.Equal(NoteProofingMode.Default, note.Mode);
        Assert.Empty(note.Effective);
    }

    [Fact]
    public async Task TheOlderSingleChoiceIsUsedWhenNoSetIsStored()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguageKey, "es-ES");

        Assert.Equal(["es-ES"], await service.ResolveActiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AnOlderSingleChoiceWithNoDictionaryFallsThrough()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguageKey, "de-DE");

        Assert.Equal(["en-US"], await service.ResolveActiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task TheOlderEditorLanguageIsMappedWhenNothingElseIsStored()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LegacyLanguageKey, "es");

        Assert.Equal(["es-ES"], await service.ResolveActiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AnOlderEditorLanguageWithNoDictionaryFallsBackToEnglish()
    {
        // The real profile this shipped against holds "nb", which has no bundled dictionary.
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LegacyLanguageKey, "nb");

        Assert.Equal(["en-US"], await service.ResolveActiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ANoteWithNoStoredChoiceFollowsTheActiveSet()
    {
        var (service, settings, _, _, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguagesKey, new[] { "es-ES", "en-US" });

        var note = await service.ResolveForNoteAsync("note-a", CancellationToken.None);

        Assert.Equal(NoteProofingMode.Default, note.Mode);
        Assert.Empty(note.Languages);
        Assert.Equal(["es-ES", "en-US"], note.Effective);
    }

    [Fact]
    public async Task ANoteWithItsOwnLanguagesIsCheckedInThoseAlone()
    {
        var (service, settings, _, _, noteLanguages, _) = Build();
        await settings.SetAsync(ProofingService.LanguagesKey, new[] { "en-US" });
        await noteLanguages.SetAsync(
            "note-a",
            new NoteLanguageEntry(NoteProofingMode.Custom, ["es-ES"]),
            CancellationToken.None);

        var note = await service.ResolveForNoteAsync("note-a", CancellationToken.None);

        Assert.Equal(NoteProofingMode.Custom, note.Mode);
        Assert.Equal(["es-ES"], note.Languages);
        Assert.Equal(["es-ES"], note.Effective);
    }

    [Fact]
    public async Task ANotesStoredLanguagesAreCanonicalisedAndOnlyInstalledOnesAreUsed()
    {
        var (service, _, _, _, noteLanguages, _) = Build();
        await noteLanguages.SetAsync(
            "note-a",
            new NoteLanguageEntry(NoteProofingMode.Custom, ["ES-es", "de-DE", "qq-QQ"]),
            CancellationToken.None);

        var note = await service.ResolveForNoteAsync("note-a", CancellationToken.None);

        Assert.Equal(["es-ES", "de-DE"], note.Languages);
        Assert.Equal(["es-ES"], note.Effective);
    }

    [Fact]
    public async Task ANoteThatIsOffIsCheckedInNothing()
    {
        var (service, _, _, _, noteLanguages, _) = Build("myocyte");
        await noteLanguages.SetAsync(
            "note-a",
            new NoteLanguageEntry(NoteProofingMode.Off, []),
            CancellationToken.None);

        var note = await service.ResolveForNoteAsync("note-a", CancellationToken.None);

        Assert.Equal(NoteProofingMode.Off, note.Mode);
        Assert.Empty(note.Languages);
        Assert.Empty(note.Effective);
        Assert.Empty(await service.CheckAsync(note.Effective, "note-a", "the myocyte", CancellationToken.None));
    }

    [Fact]
    public async Task StatusListsEveryLanguageAndMarksTheUnbundledOnesAbsent()
    {
        var (service, _, personal, _, _, _) = Build();
        await personal.AddAsync("Ordbanken", null, CancellationToken.None);

        var status = await service.GetStatusAsync(null, CancellationToken.None);

        Assert.True(status.Enabled);
        Assert.Equal(["en-US"], status.Active);
        Assert.Null(status.Note);
        Assert.Equal(1, status.PersonalWordCount);
        Assert.Equal(["de-DE", "en-US", "es-ES", "ja-JP", "nb-NO"], status.Languages.Select(l => l.Id).Order());

        var german = status.Languages.Single(l => l.Id == "de-DE");
        Assert.False(german.Installed);
        Assert.False(german.Bundled);
        Assert.Equal(ProofingLanguageState.Absent, german.State);
        Assert.False(string.IsNullOrWhiteSpace(german.ReasonKey));

        var english = status.Languages.Single(l => l.Id == "en-US");
        Assert.True(english.Installed);
        Assert.True(english.Bundled);
        Assert.Null(english.ReasonKey);
        Assert.False(string.IsNullOrWhiteSpace(english.License.Name));
    }

    [Fact]
    public async Task StatusCarriesTheNoteItWasAskedAbout()
    {
        var (service, _, _, _, noteLanguages, _) = Build();
        await noteLanguages.SetAsync(
            "note-a",
            new NoteLanguageEntry(NoteProofingMode.Custom, ["es-ES"]),
            CancellationToken.None);

        var status = await service.GetStatusAsync("note-a", CancellationToken.None);

        Assert.Equal(["en-US"], status.Active);
        Assert.Equal(NoteProofingMode.Custom, status.Note!.Mode);
        Assert.Equal(["es-ES"], status.Note.Effective);
    }

    [Fact]
    public async Task StatusReportsALanguageAsLoadingUntilItsEngineIsReady()
    {
        var engine = new StubProofingEngine(English) { Ready = false };
        var service = BuildWith(engine);

        var loading = await service.GetStatusAsync(null, CancellationToken.None);
        Assert.Equal(ProofingLanguageState.Loading, loading.Languages.Single(l => l.Id == "en-US").State);

        engine.Ready = true;
        var ready = await service.GetStatusAsync(null, CancellationToken.None);
        Assert.Equal(ProofingLanguageState.Ready, ready.Languages.Single(l => l.Id == "en-US").State);
    }

    [Fact]
    public async Task SuggestReturnsNothingForARangeOutsideTheText()
    {
        var (service, _, _, _, _, _) = Build("myocyte");

        Assert.Empty(await service.SuggestAsync(English, "short", 0, 99, null, CancellationToken.None));
        Assert.Empty(await service.SuggestAsync(English, "short", 3, 3, null, CancellationToken.None));
        Assert.Empty(await service.SuggestAsync([], "the myocyte here", 4, 11, null, CancellationToken.None));
    }

    [Fact]
    public async Task SuggestPassesTheSpanTheCallerNamed()
    {
        var (service, _, _, _, _, _) = Build("myocyte");

        var fixes = await service.SuggestAsync(English, "the myocyte here", 4, 11, null, CancellationToken.None);

        Assert.Equal("MYOCYTE", Assert.Single(fixes).Replacement);
    }

    [Fact]
    public async Task SuggestAnswersFromTheFirstLanguageEvenWhenBothHaveSomethingToOffer()
    {
        // Order is the whole point of an ordered set: the first language is the one the user writes
        // in most, and its spellings are the ones offered.
        var spanish = new StubProofingEngine(Spanish) { SuggestionLabel = "palabra" };
        var english = new StubProofingEngine(English) { SuggestionLabel = "myocytes" };
        var service = BuildWith(spanish, english);

        var spanishFirst = await service.SuggestAsync(
            ["es-ES", "en-US"],
            "the myocyte here",
            4,
            11,
            null,
            CancellationToken.None);
        Assert.Equal("palabra", Assert.Single(spanishFirst).Replacement);

        var englishFirst = await service.SuggestAsync(
            ["en-US", "es-ES"],
            "the myocyte here",
            4,
            11,
            null,
            CancellationToken.None);
        Assert.Equal("myocytes", Assert.Single(englishFirst).Replacement);
    }

    [Fact]
    public async Task SuggestMovesOnFromALanguageWithNothingToOffer()
    {
        var silent = new StubProofingEngine(Spanish) { Suggests = false };
        var speaking = new StubProofingEngine(English) { SuggestionLabel = "myocytes" };
        var service = BuildWith(silent, speaking);

        var fixes = await service.SuggestAsync(
            ["es-ES", "en-US"],
            "the myocyte here",
            4,
            11,
            null,
            CancellationToken.None);

        Assert.Equal("myocytes", Assert.Single(fixes).Replacement);
    }
}
