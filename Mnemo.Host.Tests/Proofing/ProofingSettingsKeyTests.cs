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
/// The two proofing keys as the generic settings endpoint sees them: exposed, and with the language
/// checked against the dictionaries this build actually carries.
/// </summary>
public sealed class ProofingSettingsKeyTests
{
    /// <summary>A provider holding just the proofing service, which is all the guard resolves.</summary>
    private static IServiceProvider Proofing()
    {
        var settings = new ProofingHttpHarness.MemorySettings();
        var catalog = new ProofingDictionaryCatalog();
        var proofing = new ProofingService(
            new ProofingEngineRegistry([new HunspellProofingEngine(catalog, new ProofingHttpHarness.SilentLogger())]),
            catalog,
            new PersonalDictionaryService(settings),
            new NoteIgnoreService(settings),
            settings);

        return new ServiceCollection()
            .AddSingleton<IProofingService>(proofing)
            .BuildServiceProvider();
    }

    private static JsonElement Text(string value) =>
        JsonDocument.Parse(JsonSerializer.Serialize(value)).RootElement;

    [Fact]
    public void BothProofingKeysAreExposedToTheClient()
    {
        Assert.True(SettingsKeyRegistry.TryGet("Proofing.Enabled", out var enabled));
        Assert.Equal(SettingValueKind.Boolean, enabled.Kind);

        Assert.True(SettingsKeyRegistry.TryGet("Proofing.Language", out var language));
        Assert.Equal(SettingValueKind.Text, language.Kind);
    }

    [Fact]
    public void NeitherStoreBehindTheProofingEndpointsIsExposed()
    {
        // Both hold structured JSON the generic endpoint could not serve, and both carry text the
        // user typed, so the proofing routes are the only way in.
        Assert.False(SettingsKeyRegistry.TryGet(PersonalDictionaryService.StorageKey, out _));
        Assert.False(SettingsKeyRegistry.TryGet(NoteIgnoreService.StorageKey, out _));
    }

    [Fact]
    public void AnInstalledLanguageIsAccepted()
    {
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("Proofing.Language", Text("es-ES"), Proofing()));
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("Proofing.Language", Text("en-US"), Proofing()));
    }

    [Fact]
    public void ALanguageWithNoDictionaryIsRefused()
    {
        var rejected = SettingsEndpoints.RejectUnknownProofingLanguage("Proofing.Language", Text("de-DE"), Proofing());

        var result = Assert.IsAssignableFrom<IStatusCodeHttpResult>(rejected);
        Assert.Equal(StatusCodes.Status400BadRequest, result.StatusCode);
    }

    [Fact]
    public void EveryOtherKeyPassesThroughUntouched()
    {
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("Editor.SpellCheckLanguages", Text("nb"), Proofing()));
        Assert.Null(SettingsEndpoints.RejectUnknownProofingLanguage("App.Icon", Text("de-DE"), Proofing()));
    }
}
