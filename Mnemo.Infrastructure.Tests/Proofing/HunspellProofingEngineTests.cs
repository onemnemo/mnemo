using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

/// <summary>
/// The engine against the dictionaries this build actually carries, not a stand-in. A stub would
/// agree with the tokenizer by construction and would prove nothing about whether the shipped word
/// lists load or answer.
/// </summary>
public sealed class HunspellProofingEngineTests
{
    private static HunspellProofingEngine Engine() =>
        new(new ProofingDictionaryCatalog(), new SilentLogger());

    [Fact]
    public void BothBundledLanguagesAreOffered()
    {
        Assert.Equal(["en-US", "es-ES"], Engine().Languages.Order());
    }

    [Fact]
    public async Task EnglishFlagsAMisspellingAtTheRightOffset()
    {
        const string text = "The quick brown fox jumpd over it.";

        var issues = await Engine().CheckAsync("en-US", text, CancellationToken.None);

        var issue = Assert.Single(issues);
        Assert.Equal("jumpd", issue.Text);
        Assert.Equal(text.IndexOf("jumpd", System.StringComparison.Ordinal), issue.Start);
        Assert.Equal(issue.Start + "jumpd".Length, issue.End);
        Assert.Equal("spelling", issue.Kind);
        Assert.Equal("error", issue.Tone);
        Assert.Empty(issue.Fixes);
    }

    [Fact]
    public async Task EnglishAcceptsOrdinaryProse()
    {
        var issues = await Engine().CheckAsync("en-US", "The quick brown fox jumped over the lazy dog.", CancellationToken.None);

        Assert.Empty(issues);
    }

    [Fact]
    public async Task SpanishAcceptsAWordWithANonAsciiLetter()
    {
        // The guard against a dictionary loaded through the wrong code page: with one, every accented
        // word is flagged and nothing else looks wrong.
        var issues = await Engine().CheckAsync("es-ES", "La ni\u00F1a peque\u00F1a compr\u00F3 pan.", CancellationToken.None);

        Assert.Empty(issues);
    }

    [Fact]
    public async Task SpanishFlagsAMisspelling()
    {
        var issues = await Engine().CheckAsync("es-ES", "La casaa es grande.", CancellationToken.None);

        Assert.Equal("casaa", Assert.Single(issues).Text);
    }

    [Fact]
    public async Task ALanguageWithNoDictionaryReportsNothing()
    {
        Assert.Empty(await Engine().CheckAsync("de-DE", "Straaaasse", CancellationToken.None));
        Assert.Empty(await Engine().CheckAsync("ja-JP", "text here", CancellationToken.None));
    }

    [Fact]
    public async Task SuggestionsAreOfferedAndCapped()
    {
        var engine = Engine();
        var issue = new ProofingIssue(0, 5, "jumpd", "spelling", "error", null, null, null, []);

        var fixes = await engine.SuggestAsync("en-US", issue, "jumpd", CancellationToken.None);

        Assert.NotEmpty(fixes);
        Assert.True(fixes.Count <= HunspellProofingEngine.MaxSuggestions);
        Assert.Contains(fixes, f => f.Replacement == "jumped");
    }

    [Fact]
    public async Task ALanguageIsNotReadyUntilItHasBeenAskedFor()
    {
        var engine = Engine();

        Assert.False(engine.IsReady("en-US"));

        await engine.CheckAsync("en-US", "hello", CancellationToken.None);

        Assert.True(engine.IsReady("en-US"));
        Assert.False(engine.IsReady("de-DE"));
    }

    [Fact]
    public async Task ALoneSurrogateInAParagraphIsCheckedRatherThanThrowing()
    {
        var issues = await Engine().CheckAsync("en-US", "before \uD83D jumpd after", CancellationToken.None);

        Assert.Equal("jumpd", Assert.Single(issues).Text);
    }
}
