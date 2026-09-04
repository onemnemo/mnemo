using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
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

        Assert.True(await service.ContainsAsync("ordbanken", "en-US", CancellationToken.None));
        Assert.True(await service.ContainsAsync("ORDBANKEN", "es-ES", CancellationToken.None));
        Assert.False(await service.ContainsAsync("ordbank", "en-US", CancellationToken.None));
    }

    [Fact]
    public async Task ALanguageScopedWordOnlyCountsForThatLanguage()
    {
        var service = new PersonalDictionaryService(new MemorySettings());
        await service.AddAsync("piso", "es-ES", CancellationToken.None);

        Assert.True(await service.ContainsAsync("piso", "es-ES", CancellationToken.None));
        Assert.False(await service.ContainsAsync("piso", "en-US", CancellationToken.None));
    }

    [Fact]
    public async Task AScopeWrittenAsABareCodeStillMatchesTheRegionalTag()
    {
        var service = new PersonalDictionaryService(new MemorySettings());
        await service.AddAsync("glycolysis", "en", CancellationToken.None);

        Assert.True(await service.ContainsAsync("glycolysis", "en-US", CancellationToken.None));
        Assert.False(await service.ContainsAsync("glycolysis", "es-ES", CancellationToken.None));
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

        await service.AddAsync("naiv", null, CancellationToken.None);
        await service.AddAsync("Naiv", null, CancellationToken.None);

        Assert.Single(await service.ListAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ParallelAddsAllSurvive()
    {
        // The gate is the point of this test. A settings write replaces the whole value, so without
        // one every one of these reads the same empty list and only the last write survives.
        var settings = new MemorySettings { WriteDelay = TimeSpan.FromMilliseconds(5) };
        var service = new PersonalDictionaryService(settings);

        var words = Enumerable.Range(0, 24).Select(i => $"word{(char)('a' + i % 24)}{i}").ToArray();
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
}
