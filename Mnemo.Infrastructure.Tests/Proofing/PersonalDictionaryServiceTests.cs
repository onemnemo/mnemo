using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

public sealed class PersonalDictionaryServiceTests
{
    [Fact]
    public async Task AWordIsStoredWithTheCasingItWasTypedIn()
    {
        var service = new PersonalDictionaryService(new MemorySettings());

        await service.AddAsync("Ordbanken", null, CancellationToken.None);

        var word = Assert.Single(await service.ListAsync(CancellationToken.None));
        Assert.Equal("Ordbanken", word.Word);
        Assert.Null(word.Language);
    }

    [Fact]
    public async Task MatchingIgnoresCase()
    {
        var service = new PersonalDictionaryService(new MemorySettings());
        await service.AddAsync("Ordbanken", null, CancellationToken.None);
        var lookup = await service.LookupAsync(CancellationToken.None);

        Assert.True(lookup.Accepts("ordbanken", ["en-US"]));
        Assert.True(lookup.Accepts("ORDBANKEN", ["es-ES"]));
        Assert.False(lookup.Accepts("ordbank", ["en-US"]));
    }

    [Fact]
    public async Task ALanguageScopedWordOnlyCountsForThatLanguage()
    {
        var service = new PersonalDictionaryService(new MemorySettings());
        await service.AddAsync("piso", "es-ES", CancellationToken.None);
        var lookup = await service.LookupAsync(CancellationToken.None);

        Assert.True(lookup.Accepts("piso", ["es-ES"]));
        Assert.False(lookup.Accepts("piso", ["en-US"]));
    }

    [Fact]
    public async Task AScopeWrittenAsABareCodeStillMatchesTheRegionalTag()
    {
        var service = new PersonalDictionaryService(new MemorySettings());
        await service.AddAsync("glycolysis", "en", CancellationToken.None);
        var lookup = await service.LookupAsync(CancellationToken.None);

        Assert.True(lookup.Accepts("glycolysis", ["en-US"]));
        Assert.False(lookup.Accepts("glycolysis", ["es-ES"]));
    }

    [Fact]
    public async Task AnAccentedWordMatchesWhicheverWayItWasEncoded()
    {
        // The editor sends what the user typed and a dictionary answers with what it read, so the two
        // can disagree on whether an accent is one character or a letter with a combining mark.
        const string composed = "r\u00e9sum\u00e9";
        const string decomposed = "re\u0301sume\u0301";

        var service = new PersonalDictionaryService(new MemorySettings());
        await service.AddAsync(decomposed, null, CancellationToken.None);
        var lookup = await service.LookupAsync(CancellationToken.None);

        Assert.True(lookup.Accepts(composed, ["en-US"]));

        // And the removal aimed at the other spelling still finds it.
        await service.RemoveAsync(composed, null, CancellationToken.None);
        Assert.Empty(await service.ListAsync(CancellationToken.None));
    }

    [Fact]
    public async Task RemovalNeedsTheSameScope()
    {
        var service = new PersonalDictionaryService(new MemorySettings());
        await service.AddAsync("piso", "es-ES", CancellationToken.None);

        await service.RemoveAsync("piso", null, CancellationToken.None);
        Assert.Single(await service.ListAsync(CancellationToken.None));

        await service.RemoveAsync("PISO", "es-ES", CancellationToken.None);
        Assert.Empty(await service.ListAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AddingTheSameWordTwiceStoresItOnce()
    {
        var service = new PersonalDictionaryService(new MemorySettings());

        Assert.Equal(PersonalWordAddResult.Added, await service.AddAsync("naiv", null, CancellationToken.None));
        Assert.Equal(PersonalWordAddResult.AlreadyPresent, await service.AddAsync("Naiv", null, CancellationToken.None));

        Assert.Single(await service.ListAsync(CancellationToken.None));
    }

    [Theory]
    [InlineData("two words")]
    [InlineData("plan9")]
    [InlineData("...")]
    [InlineData("a")]
    [InlineData("   ")]
    public async Task AnEntryTheCheckerCouldNeverAskAboutIsRefused(string entry)
    {
        var service = new PersonalDictionaryService(new MemorySettings());

        Assert.Equal(PersonalWordAddResult.NotCheckable, await service.AddAsync(entry, null, CancellationToken.None));
        Assert.Empty(await service.ListAsync(CancellationToken.None));
    }

    [Fact]
    public async Task TheListStopsGrowingAtItsLimit()
    {
        var service = new PersonalDictionaryService(new MemorySettings());
        var settings = new MemorySettings();
        var full = Enumerable
            .Range(0, service.MaxWords)
            .Select(i => new PersonalWord($"word{Stem(i)}", null, DateTimeOffset.UtcNow))
            .ToList();
        settings.Seed(PersonalDictionaryService.StorageKey, full);

        var loaded = new PersonalDictionaryService(settings);

        Assert.Equal(PersonalWordAddResult.LimitReached, await loaded.AddAsync("onemore", null, CancellationToken.None));
    }

    [Fact]
    public async Task ParallelAddsAllSurvive()
    {
        // The gate is the point of this test. A settings write replaces the whole value, so without
        // one every one of these reads the same empty list and only the last write survives.
        var settings = new MemorySettings { WriteDelay = TimeSpan.FromMilliseconds(5) };
        var service = new PersonalDictionaryService(settings);

        var words = Enumerable.Range(0, 24).Select(i => $"word{Stem(i)}").ToArray();
        await Task.WhenAll(words.Select(w => service.AddAsync(w, null, CancellationToken.None)));

        var stored = await service.ListAsync(CancellationToken.None);
        Assert.Equal(words.Length, stored.Count);
        Assert.Equal([.. words.Order()], [.. stored.Select(s => s.Word).Order()]);
    }

    [Fact]
    public async Task TheOlderEditorWordListSeedsTheStoreOnceOnFirstRead()
    {
        var settings = new MemorySettings().Seed(
            PersonalDictionaryService.LegacyStorageKey,
            new Dictionary<string, string[]> { ["en"] = ["glycolysis", "myocyte"] });
        var service = new PersonalDictionaryService(settings);

        var seeded = await service.ListAsync(CancellationToken.None);

        Assert.Equal(["glycolysis", "myocyte"], seeded.Select(w => w.Word).Order());
        Assert.All(seeded, w => Assert.Equal("en", w.Language));

        // The old key is left alone: it is the only copy of that data.
        var legacy = await settings.GetAsync<Dictionary<string, string[]>?>(
            PersonalDictionaryService.LegacyStorageKey, null);
        Assert.NotNull(legacy);
    }

    [Fact]
    public async Task SeedingDoesNotRunOnceTheStoreHasItsOwnValue()
    {
        var settings = new MemorySettings().Seed(
            PersonalDictionaryService.LegacyStorageKey,
            new Dictionary<string, string[]> { ["en"] = ["glycolysis"] });

        var first = new PersonalDictionaryService(settings);
        await first.AddAsync("debounce", null, CancellationToken.None);
        await first.RemoveAsync("glycolysis", "en", CancellationToken.None);

        var second = new PersonalDictionaryService(settings);

        Assert.Equal(["debounce"], (await second.ListAsync(CancellationToken.None)).Select(w => w.Word));
    }

    /// <summary>A distinct all-letter suffix. Anything with a digit in it is not a storable word.</summary>
    private static string Stem(int index) =>
        $"{(char)('a' + index / 26 % 26)}{(char)('a' + index % 26)}";
}
