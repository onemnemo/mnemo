using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

public sealed class ProofingServiceTests
{
    private static (ProofingService Service, MemorySettings Settings, PersonalDictionaryService Personal, NoteIgnoreService Ignores)
        Build(params string[] flagged)
    {
        var settings = new MemorySettings();
        var personal = new PersonalDictionaryService(settings);
        var ignores = new NoteIgnoreService(settings);
        var registry = new ProofingEngineRegistry([new StubProofingEngine(["en-US", "es-ES"], flagged)]);
        var catalog = new ProofingDictionaryCatalog();
        return (new ProofingService(registry, catalog, personal, ignores, settings), settings, personal, ignores);
    }

    [Fact]
    public async Task AWordInThePersonalDictionaryIsNotReported()
    {
        var (service, _, personal, _) = Build("Ordbanken", "myocyte");

        var before = await service.CheckAsync("en-US", null, "Ordbanken and myocyte", CancellationToken.None);
        Assert.Equal(2, before.Count);

        await personal.AddAsync("ordbanken", null, CancellationToken.None);

        var after = await service.CheckAsync("en-US", null, "Ordbanken and myocyte", CancellationToken.None);
        Assert.Equal("myocyte", Assert.Single(after).Text);
    }

    [Fact]
    public async Task AWordIgnoredInOneNoteIsStillReportedInAnother()
    {
        var (service, _, _, ignores) = Build("myocyte");
        await ignores.AddAsync("note-a", "MYOCYTE", CancellationToken.None);

        Assert.Empty(await service.CheckAsync("en-US", "note-a", "the myocyte", CancellationToken.None));
        Assert.Single(await service.CheckAsync("en-US", "note-b", "the myocyte", CancellationToken.None));
        Assert.Single(await service.CheckAsync("en-US", null, "the myocyte", CancellationToken.None));
    }

    [Fact]
    public async Task IssuesComeBackInDocumentOrder()
    {
        var (service, _, _, _) = Build("zeta", "alpha");

        var issues = await service.CheckAsync("en-US", null, "alpha then zeta", CancellationToken.None);

        Assert.Equal(["alpha", "zeta"], issues.Select(i => i.Text));
    }

    [Fact]
    public async Task ALanguageNoEngineServesReportsNothing()
    {
        var (service, _, _, _) = Build("myocyte");

        Assert.Empty(await service.CheckAsync("de-DE", null, "the myocyte", CancellationToken.None));
    }

    [Fact]
    public async Task TheStoredLanguageWinsWhenItsDictionaryIsInstalled()
    {
        var (service, settings, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguageKey, "es-ES");

        Assert.Equal("es-ES", await service.ResolveLanguageAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AStoredLanguageWithNoDictionaryFallsThrough()
    {
        var (service, settings, _, _) = Build();
        await settings.SetAsync(ProofingService.LanguageKey, "de-DE");

        Assert.Equal("en-US", await service.ResolveLanguageAsync(CancellationToken.None));
    }

    [Fact]
    public async Task TheOlderEditorLanguageIsMappedWhenNothingIsStored()
    {
        var (service, settings, _, _) = Build();
        await settings.SetAsync(ProofingService.LegacyLanguageKey, "es");

        Assert.Equal("es-ES", await service.ResolveLanguageAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AnOlderEditorLanguageWithNoDictionaryFallsBackToEnglish()
    {
        // The real profile this shipped against holds "nb", which has no bundled dictionary.
        var (service, settings, _, _) = Build();
        await settings.SetAsync(ProofingService.LegacyLanguageKey, "nb");

        Assert.Equal("en-US", await service.ResolveLanguageAsync(CancellationToken.None));
    }

    [Fact]
    public async Task StatusListsEveryLanguageAndMarksTheUnbundledOnesAbsent()
    {
        var (service, _, personal, _) = Build();
        await personal.AddAsync("Ordbanken", null, CancellationToken.None);

        var status = await service.GetStatusAsync(CancellationToken.None);

        Assert.True(status.Enabled);
        Assert.Equal("en-US", status.Language);
        Assert.Equal(1, status.PersonalWordCount);
        Assert.Equal(["de-DE", "en-US", "es-ES", "nb-NO"], status.Languages.Select(l => l.Id).Order());

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
    public async Task StatusReportsALanguageAsLoadingUntilItsEngineIsReady()
    {
        var settings = new MemorySettings();
        var engine = new StubProofingEngine(["en-US"]) { Ready = false };
        var service = new ProofingService(
            new ProofingEngineRegistry([engine]),
            new ProofingDictionaryCatalog(),
            new PersonalDictionaryService(settings),
            new NoteIgnoreService(settings),
            settings);

        var loading = await service.GetStatusAsync(CancellationToken.None);
        Assert.Equal(ProofingLanguageState.Loading, loading.Languages.Single(l => l.Id == "en-US").State);

        engine.Ready = true;
        var ready = await service.GetStatusAsync(CancellationToken.None);
        Assert.Equal(ProofingLanguageState.Ready, ready.Languages.Single(l => l.Id == "en-US").State);
    }

    [Fact]
    public async Task SuggestReturnsNothingForARangeOutsideTheText()
    {
        var (service, _, _, _) = Build("myocyte");

        Assert.Empty(await service.SuggestAsync("en-US", "short", 0, 99, null, CancellationToken.None));
        Assert.Empty(await service.SuggestAsync("en-US", "short", 3, 3, null, CancellationToken.None));
    }

    [Fact]
    public async Task SuggestPassesTheSpanTheCallerNamed()
    {
        var (service, _, _, _) = Build("myocyte");

        var fixes = await service.SuggestAsync("en-US", "the myocyte here", 4, 11, null, CancellationToken.None);

        Assert.Equal("MYOCYTE", Assert.Single(fixes).Replacement);
    }
}
