using System.Text.Json.Nodes;
using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Host.Chrome;
using Xunit;

namespace Mnemo.Host.Tests.Chrome;

public sealed class WebViewSpellcheckTests : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), "mnemo-host-tests", Guid.NewGuid().ToString("N"));

    private readonly SilentLogger _logger = new();

    private string PreferencesPath => Path.Combine(_root, "EBWebView", "Default", "Preferences");

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    private void WritePreferences(string json)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(PreferencesPath)!);
        File.WriteAllText(PreferencesPath, json);
    }

    private JsonObject Read() => (JsonObject)JsonNode.Parse(File.ReadAllText(PreferencesPath))!;

    private static string[] DictionariesIn(JsonObject preferences) =>
        ((JsonArray)preferences["spellcheck"]!["dictionaries"]!).Select(node => node!.GetValue<string>()).ToArray();

    [Fact]
    public void ReplacesTheInheritedDictionaryWithTheChosenOne()
    {
        WritePreferences("""{"spellcheck":{"dictionaries":["nb"],"dictionary":""},"intl":{"selected_languages":"nb,no,en,en-GB,en-US"}}""");

        WebViewSpellcheck.Apply(_root, "en", _logger);

        // Replaced, not added: every enabled dictionary is consulted, so an
        // inherited one left in place would keep accepting the same words.
        Assert.Equal(["en-US"], DictionariesIn(Read()));
    }

    [Fact]
    public void LeavesTheRestOfTheProfileAlone()
    {
        WritePreferences("""{"profile":{"name":"kept"},"spellcheck":{"dictionaries":["nb"],"dictionary":"legacy"}}""");

        WebViewSpellcheck.Apply(_root, "de", _logger);

        var after = Read();
        Assert.Equal("kept", after["profile"]!["name"]!.GetValue<string>());
        Assert.Equal("legacy", after["spellcheck"]!["dictionary"]!.GetValue<string>());
    }

    [Fact]
    public void SeedsAProfileThatDoesNotExistYet()
    {
        WebViewSpellcheck.Apply(_root, "nb", _logger);

        Assert.True(File.Exists(PreferencesPath));
        Assert.Equal(["nb"], DictionariesIn(Read()));
    }

    [Fact]
    public void OffersTheLanguageWhenTheProfileDoesNotListIt()
    {
        WritePreferences("""{"intl":{"selected_languages":"nb,no"}}""");

        WebViewSpellcheck.Apply(_root, "es", _logger);

        Assert.Equal("nb,no,es", Read()["intl"]!["selected_languages"]!.GetValue<string>());
    }

    [Fact]
    public void CountsARegionalVariantAsTheLanguageAlreadyListed()
    {
        WritePreferences("""{"intl":{"selected_languages":"nb,en-GB"}}""");

        WebViewSpellcheck.Apply(_root, "en", _logger);

        Assert.Equal("nb,en-GB", Read()["intl"]!["selected_languages"]!.GetValue<string>());
    }

    [Fact]
    public void LeavesTheFileUntouchedWhenItAlreadySaysTheSameThing()
    {
        WritePreferences("""{"spellcheck":{"dictionaries":["en-US"]},"intl":{"selected_languages":"en-US"}}""");
        var written = File.GetLastWriteTimeUtc(PreferencesPath);

        WebViewSpellcheck.Apply(_root, "en", _logger);

        Assert.Equal(written, File.GetLastWriteTimeUtc(PreferencesPath));
    }

    [Fact]
    public void LeavesTheProfileAloneForALanguageWithNoDictionary()
    {
        WritePreferences("""{"spellcheck":{"dictionaries":["nb"]}}""");

        WebViewSpellcheck.Apply(_root, "fr", _logger);

        Assert.Equal(["nb"], DictionariesIn(Read()));
    }

    [Fact]
    public void TreatsAnUnreadableProfileAsAFreshOne()
    {
        WritePreferences("not json");

        WebViewSpellcheck.Apply(_root, "en", _logger);

        Assert.Equal(["en-US"], DictionariesIn(Read()));
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
