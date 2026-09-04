using Mnemo.Infrastructure.Modules.Proofing;

namespace Mnemo.Host.Tests.I18n;

/// <summary>
/// Holds the bundle to the language names the proofing catalog asks for. The catalog derives a
/// key from each tag it carries, so nothing in the sources names these keys and no scrape can
/// find them: a language added to the manifest reaches the settings page and the note menu with
/// a key that resolves nowhere, and every reader sees the dotted key instead of a word.
/// </summary>
public sealed class ProofingLanguageNameTests
{
    private static readonly ProofingDictionaryCatalog Catalog = new();

    public static TheoryData<string, string> CultureAndTag()
    {
        var data = new TheoryData<string, string>();
        foreach (var culture in ServedTranslationBundle.Cultures)
            foreach (var entry in Catalog.Entries)
                data.Add(culture, entry.Id);
        return data;
    }

    [Theory]
    [MemberData(nameof(CultureAndTag))]
    public async Task EveryCatalogLanguageIsNamedInEveryCulture(string culture, string tag)
    {
        var bundle = await ServedTranslationBundle.FromHostComposition().LoadAsync(culture);
        var common = Assert.Contains("Common", bundle);

        Assert.True(
            common.TryGetValue(ProofingDictionaryCatalog.NameKeyFor(tag), out var name)
                && !string.IsNullOrWhiteSpace(name),
            $"Common/{ProofingDictionaryCatalog.NameKeyFor(tag)} is missing from {culture}.");

        Assert.True(
            common.TryGetValue(ProofingDictionaryCatalog.RegionKeyFor(tag), out var region)
                && !string.IsNullOrWhiteSpace(region),
            $"Common/{ProofingDictionaryCatalog.RegionKeyFor(tag)} is missing from {culture}.");
    }

    [Fact]
    public void TheCatalogCarriesTheLanguagesTheBundlesWereWrittenFor()
    {
        // The theory above is generated from the catalog, so a catalog that came back empty would
        // produce no cases and leave the bundles unchecked without failing anything.
        Assert.Equal(
            ["en-US", "es-ES", "de-DE", "nb-NO", "ja-JP"],
            Catalog.Entries.Select(entry => entry.Id));
    }
}
