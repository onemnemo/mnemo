using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.I18n;

namespace Mnemo.Host.Tests.I18n;

/// <summary>
/// Covers the bundle the SPA is actually served, and in particular the English
/// floor under every other culture: a key nobody has translated must reach the
/// screen as English words, never as its own identifier.
/// </summary>
public sealed class TranslationBundleServiceTests
{
    [Fact]
    public async Task AnUntranslatedKeyFallsBackToEnglish()
    {
        var service = Build(new FakeSource(new()
        {
            ["en"] = new() { ["Notes"] = new() { ["Title"] = "Notes", ["Retry"] = "Retry" } },
            ["nb"] = new() { ["Notes"] = new() { ["Title"] = "Notater" } },
        }));

        var bundle = await service.GetBundleAsync("nb");

        Assert.Equal("Retry", bundle["Notes"]["Retry"]);
    }

    [Fact]
    public async Task ATranslatedKeyWinsOverEnglish()
    {
        var service = Build(new FakeSource(new()
        {
            ["en"] = new() { ["Notes"] = new() { ["Title"] = "Notes" } },
            ["nb"] = new() { ["Notes"] = new() { ["Title"] = "Notater" } },
        }));

        var bundle = await service.GetBundleAsync("nb");

        Assert.Equal("Notater", bundle["Notes"]["Title"]);
    }

    [Fact]
    public async Task ANamespaceMissingEntirelyStillArrivesInEnglish()
    {
        var service = Build(new FakeSource(new()
        {
            ["en"] = new() { ["Flashcards"] = new() { ["Title"] = "Flashcards" } },
            ["nb"] = new() { ["Notes"] = new() { ["Title"] = "Notater" } },
        }));

        var bundle = await service.GetBundleAsync("nb");

        Assert.Equal("Flashcards", bundle["Flashcards"]["Title"]);
    }

    [Fact]
    public async Task EnglishIsBuiltFromItselfOnly()
    {
        var source = new FakeSource(new()
        {
            ["en"] = new() { ["Notes"] = new() { ["Title"] = "Notes" } },
        });
        var service = Build(source);

        await service.GetBundleAsync("en");

        // One request, not two: English asking English for a floor would recurse.
        Assert.Equal(["en"], source.Requested);
    }

    [Fact]
    public async Task ARegionalEnglishIsStillEnglish()
    {
        var source = new FakeSource(new()
        {
            ["en"] = new() { ["Notes"] = new() { ["Title"] = "Notes" } },
        });
        var service = Build(source);

        await service.GetBundleAsync("en-GB");

        Assert.Equal(["en-GB"], source.Requested);
    }

    [Fact]
    public async Task OverlayingACultureLeavesEnglishAlone()
    {
        var service = Build(new FakeSource(new()
        {
            ["en"] = new() { ["Notes"] = new() { ["Title"] = "Notes" } },
            ["nb"] = new() { ["Notes"] = new() { ["Title"] = "Notater" } },
        }));

        await service.GetBundleAsync("nb");
        var english = await service.GetBundleAsync("en");

        // The English bundle is cached and handed to every other culture as its
        // base. Overlaying in place would rewrite it for whoever asks next.
        Assert.Equal("Notes", english["Notes"]["Title"]);
    }

    [Fact]
    public async Task EnglishIsMergedOnceForManyCultures()
    {
        var source = new FakeSource(new()
        {
            ["en"] = new() { ["Notes"] = new() { ["Title"] = "Notes" } },
            ["nb"] = new() { ["Notes"] = new() { ["Title"] = "Notater" } },
            ["de"] = new() { ["Notes"] = new() { ["Title"] = "Notizen" } },
        });
        var service = Build(source);

        await service.GetBundleAsync("nb");
        await service.GetBundleAsync("de");

        Assert.Equal(1, source.Requested.Count(c => c == "en"));
    }

    [Fact]
    public async Task AFailingSourceDoesNotTakeTheBundleWithIt()
    {
        var service = Build(
            new ThrowingSource(),
            new FakeSource(new()
            {
                ["en"] = new() { ["Notes"] = new() { ["Title"] = "Notes" } },
            }));

        var bundle = await service.GetBundleAsync("en");

        Assert.Equal("Notes", bundle["Notes"]["Title"]);
    }

    private static TranslationBundleService Build(params ITranslationSource[] sources)
        => new(sources, new StubLocalization(), new SilentLogger());

    private sealed class FakeSource : ITranslationSource
    {
        private readonly Dictionary<string, Dictionary<string, Dictionary<string, string>>> _byCulture;

        public FakeSource(Dictionary<string, Dictionary<string, Dictionary<string, string>>> byCulture)
            => _byCulture = byCulture;

        public List<string> Requested { get; } = [];

        public Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> GetTranslationsForCultureAsync(
            string cultureCode, CancellationToken cancellationToken = default)
        {
            Requested.Add(cultureCode);
            var found = _byCulture.TryGetValue(cultureCode, out var data) ? data : [];
            return Task.FromResult<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>>(
                found.ToDictionary(
                    pair => pair.Key,
                    pair => (IReadOnlyDictionary<string, string>)pair.Value));
        }
    }

    private sealed class ThrowingSource : ITranslationSource
    {
        public Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> GetTranslationsForCultureAsync(
            string cultureCode, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("this pack is corrupt");
    }

    private sealed class StubLocalization : ILocalizationService
    {
        public string CurrentLanguage => "en";
        public event EventHandler? LanguageChanged { add { } remove { } }
        public string GetString(string key, string? ns = null) => key;
        public string T(string key, string? ns = null) => key;
        public Task<bool> SetLanguageAsync(string languageCode, CancellationToken cancellationToken = default)
            => Task.FromResult(true);
        public Task<IEnumerable<LanguageManifest>> GetAvailableLanguagesAsync()
            => Task.FromResult<IEnumerable<LanguageManifest>>([]);
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
