using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

/// <summary>
/// Every list of languages that crosses a boundary comes through here, and everything above it
/// compares ids exactly, so this is where a caller's spelling is replaced by the catalog's.
/// </summary>
public sealed class ProofingLanguagesTests
{
    private static readonly ProofingDictionaryCatalog Catalog = new();

    [Fact]
    public void TheCatalogSpellingWinsOverTheCallers()
    {
        Assert.Equal(["en-US", "es-ES"], ProofingLanguages.Canonical(Catalog, ["EN-us", "es-es"]));
    }

    [Fact]
    public void DuplicatesAreDroppedAndFirstPlaceIsKept()
    {
        Assert.Equal(["es-ES", "en-US"], ProofingLanguages.Canonical(Catalog, ["es-ES", "en-US", "ES-es"]));
    }

    [Fact]
    public void ALanguageTheCatalogDoesNotCarryIsDropped()
    {
        Assert.Equal(["en-US"], ProofingLanguages.Canonical(Catalog, ["qq-QQ", "en-US", "", null]));
        Assert.Empty(ProofingLanguages.Canonical(Catalog, null));
    }

    [Fact]
    public void AnUninstalledLanguageIsStillACatalogLanguage()
    {
        // Filtering to what can actually be checked happens in resolution, not here, so a settings
        // page holding a language a later build will ship survives the round trip.
        Assert.Equal(["de-DE"], ProofingLanguages.Canonical(Catalog, ["de-DE"]));
    }
}
