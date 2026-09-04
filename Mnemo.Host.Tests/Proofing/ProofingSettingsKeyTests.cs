using System;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services.Proofing;
using Mnemo.Host.Settings;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Host.Tests.Proofing;

/// <summary>
/// The proofing keys as the generic settings endpoint sees them: exposed, and with the languages
/// checked against the dictionaries this build actually carries.
/// </summary>
public sealed class ProofingSettingsKeyTests
{
    /// <summary>A provider holding what the two proofing guards resolve, and nothing else.</summary>
    private static IServiceProvider Proofing()
    {
        var settings = new ProofingHttpHarness.MemorySettings();
        var catalog = new ProofingDictionaryCatalog();
        var proofing = new ProofingService(
            new ProofingEngineRegistry([new HunspellProofingEngine(catalog, new ProofingHttpHarness.SilentLogger())]),
            catalog,
            new PersonalDictionaryService(settings),
            new NoteIgnoreService(settings),
            new NoteLanguageService(settings),
            settings);

        return new ServiceCollection()
            .AddSingleton<IProofingService>(proofing)
            .AddSingleton(catalog)
            .BuildServiceProvider();
    }

    private static JsonElement Text(string value) =>
        JsonDocument.Parse(JsonSerializer.Serialize(value)).RootElement;

    [Fact]
    public void EveryProofingKeyIsExposedToTheClient()
    {
        Assert.True(SettingsKeyRegistry.TryGet("Proofing.Enabled", out var enabled));
        Assert.Equal(SettingValueKind.Boolean, enabled.Kind);

        Assert.True(SettingsKeyRegistry.TryGet("Proofing.Languages", out var languages));
        Assert.Equal(SettingValueKind.StringList, languages.Kind);

        // The older single choice keeps its row: nothing writes it any more, and a downgrade to a
        // build that only knows that key still reads it.
        Assert.True(SettingsKeyRegistry.TryGet("Proofing.Language", out var language));
        Assert.Equal(SettingValueKind.Text, language.Kind);
    }

    [Fact]
    public void NoStoreBehindTheProofingEndpointsIsExposed()
    {
        // All three hold structured JSON the generic endpoint could not serve, and all three are
        // keyed by note or carry text the user typed, so the proofing routes are the only way in.
        Assert.False(SettingsKeyRegistry.TryGet(PersonalDictionaryService.StorageKey, out _));
        Assert.False(SettingsKeyRegistry.TryGet(NoteIgnoreService.StorageKey, out _));
        Assert.False(SettingsKeyRegistry.TryGet(NoteLanguageService.StorageKey, out _));
    }

    [Fact]
    public void AnInstalledLanguageIsAccepted()
    {
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("Proofing.Language", Text("es-ES"), Proofing()));
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("Proofing.Language", Text("en-US"), Proofing()));
    }

    [Theory]
    [InlineData("de-DE")]
    [InlineData("nb-NO")]
    // Listed by the status endpoint so the settings page can explain it, and refused here for the
    // same reason as the other two: nothing can check it.
    [InlineData("ja-JP")]
    [InlineData("qq-QQ")]
    public void ALanguageWithNoDictionaryIsRefused(string language)
    {
        var rejected = SettingsEndpoints.RejectUnknownProofingLanguage("Proofing.Language", Text(language), Proofing());

        var result = Assert.IsAssignableFrom<IStatusCodeHttpResult>(rejected);
        Assert.Equal(StatusCodes.Status400BadRequest, result.StatusCode);
    }

    [Fact]
    public void EveryOtherKeyPassesThroughUntouched()
    {
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("App.Language", Text("nb"), Proofing()));
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("App.Icon", Text("de-DE"), Proofing()));
    }

    [Fact]
    public void TheStoredSetTakesTheCatalogSpellingWithoutDuplicates()
    {
        var canonical = SettingsEndpoints.CanonicalProofingLanguages(["ES-es", "en-US", "es-ES"], Proofing());

        Assert.Equal(["es-ES", "en-US"], canonical!);
    }

    [Fact]
    public void ASetNamingALanguageThisBuildDoesNotKnowIsRefused()
    {
        Assert.Null(SettingsEndpoints.CanonicalProofingLanguages(["en-US", "qq-QQ"], Proofing()));
        Assert.Null(SettingsEndpoints.CanonicalProofingLanguages([""], Proofing()));
    }

    [Fact]
    public void AnUninstalledLanguageMayStillBeStored()
    {
        // Resolution filters the set down to what can be checked, so a language the picker lists as
        // not available yet round trips rather than failing the write.
        Assert.Equal(["de-DE"], SettingsEndpoints.CanonicalProofingLanguages(["de-DE"], Proofing())!);
        Assert.Empty(SettingsEndpoints.CanonicalProofingLanguages([], Proofing())!);
    }
}
