using System.Diagnostics;
using System.Linq;
using System.Threading;
using Mnemo.Infrastructure.Modules.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

/// <summary>
/// The tokenizer decides what the client will underline, so its offsets are the contract.
/// <para>
/// Every offset assertion here is an exact integer compared against what the same string index would
/// be in JavaScript. Asserting a range instead would pass for an offset counted in runes rather than
/// in UTF-16 code units, which is the mistake that puts the underline under the wrong word for every
/// paragraph containing an emoji.
/// </para>
/// </summary>
public sealed class ProofingTokenizerTests
{
    private static string[] Words(string text) =>
        [.. ProofingTokenizer.Tokenize(text).Select(t => text[t.Start..t.End])];

    [Fact]
    public void AnAstralEmojiShiftsLaterOffsetsByTwo()
    {
        const string text = "\U0001F389 teh party";

        var tokens = ProofingTokenizer.Tokenize(text);

        // The emoji is a surrogate pair, so "teh" starts at 3 and not at 2.
        Assert.Equal(3, text.IndexOf("teh", System.StringComparison.Ordinal));
        Assert.Equal(3, tokens[0].Start);
        Assert.Equal(6, tokens[0].End);
        Assert.Equal("teh", text[tokens[0].Start..tokens[0].End]);
    }

    [Fact]
    public void ASurrogatePairIsNeverSplit()
    {
        Assert.Equal(["wow", "done"], Words("wow \U0001F600 done"));
    }

    [Fact]
    public void ACombiningMarkIsInsideTheWordAndCostsOneCodeUnit()
    {
        // The same word twice: once with a combining diaeresis, once precomposed. The first is one
        // UTF-16 code unit longer, and a client indexing the string it sent has to see that.
        const string decomposed = "say nai\u0308ve now";
        const string precomposed = "say na\u00EFve now";

        var fromDecomposed = ProofingTokenizer.Tokenize(decomposed);
        var fromPrecomposed = ProofingTokenizer.Tokenize(precomposed);

        Assert.Equal(3, fromDecomposed.Count);
        Assert.Equal("nai\u0308ve", decomposed[fromDecomposed[1].Start..fromDecomposed[1].End]);
        Assert.Equal("na\u00EFve", precomposed[fromPrecomposed[1].Start..fromPrecomposed[1].End]);

        Assert.Equal(6, fromDecomposed[1].Length);
        Assert.Equal(5, fromPrecomposed[1].Length);
        Assert.Equal(fromPrecomposed[2].Start + 1, fromDecomposed[2].Start);
    }

    [Fact]
    public void ALoneSurrogateIsSteppedOverRatherThanThrowing()
    {
        const string text = "before \uD83D after";

        var words = Words(text);

        Assert.Equal(["before", "after"], words);
    }

    [Fact]
    public void CurlyAndStraightApostrophesProduceTheSameWord()
    {
        var straight = ProofingTokenizer.Tokenize("don't");
        var curly = ProofingTokenizer.Tokenize("don\u2019t");

        Assert.Equal(5, Assert.Single(straight).Length);
        Assert.Equal(5, Assert.Single(curly).Length);
    }

    [Fact]
    public void AnApostropheOnlyJoinsWhenItIsInsideTheWord()
    {
        Assert.Equal(["color"], Words("'color'"));
    }

    [Fact]
    public void AHyphenJoinsTwoWordsIntoOne()
    {
        Assert.Equal(["well-known"], Words("well-known"));
    }

    [Fact]
    public void WordsHoldingDigitsAreSkipped()
    {
        Assert.Empty(Words("abc123 2026 v2"));
    }

    [Fact]
    public void SingleLettersAreSkipped()
    {
        Assert.Equal(["cat"], Words("a cat I"));
    }

    [Fact]
    public void UrlsAndEmailAddressesAreSkipped()
    {
        Assert.Equal(["Ask"], Words("Ask alice@example.com"));
        Assert.Empty(Words("https://example.com/some/path"));
        Assert.Empty(Words("www.example.com"));
    }

    [Fact]
    public void AWordLongerThanTheCapIsSkipped()
    {
        var atCap = new string('a', ProofingTokenizer.MaxWordLength);
        var overCap = new string('a', ProofingTokenizer.MaxWordLength + 1);

        Assert.Equal([atCap], Words(atCap));
        Assert.Empty(Words(overCap));
    }

    [Fact]
    public void TextThatIsAllAddressesIsStillLinear()
    {
        // Every whitespace run here is an address, so every candidate token has to be tested against
        // the skip list. Rescanning that list per token made 200k characters of this take seconds.
        var text = string.Concat(Enumerable.Repeat("ab@cd ", 33_000));
        Assert.True(text.Length > 190_000);

        var clock = Stopwatch.StartNew();
        var tokens = ProofingTokenizer.Tokenize(text);
        clock.Stop();

        Assert.Empty(tokens);
        Assert.True(clock.ElapsedMilliseconds < 1000, $"Tokenizing took {clock.ElapsedMilliseconds} ms.");
    }

    [Fact]
    public void ALinkDenseParagraphIsStillLinear()
    {
        var text = string.Concat(Enumerable.Repeat("some ordinary words here https://example.com/a/b ", 4_000));

        var clock = Stopwatch.StartNew();
        var tokens = ProofingTokenizer.Tokenize(text);
        clock.Stop();

        Assert.NotEmpty(tokens);
        Assert.True(clock.ElapsedMilliseconds < 1000, $"Tokenizing took {clock.ElapsedMilliseconds} ms.");
    }

    [Fact]
    public void ACancelledTokenStopsALargeScan()
    {
        // A single paragraph can be big enough that a caller's deadline has to reach inside the scan.
        var text = string.Concat(Enumerable.Repeat("some ordinary words here ", 40_000));
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        Assert.Throws<OperationCanceledException>(() => ProofingTokenizer.Tokenize(text, cancelled.Token));
    }

    [Fact]
    public void ShortTextIgnoresACancelledToken()
    {
        // The check is interval based, so a paragraph shorter than one interval never looks at the
        // token. That is deliberate: the cost of checking would exceed the work being interrupted.
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        Assert.Equal(["hello", "there"], Words("hello there"));
        Assert.Equal(["hello", "there"], ProofingTokenizer.Tokenize("hello there", cancelled.Token)
            .Select(t => "hello there"[t.Start..t.End]));
    }

    [Fact]
    public void EmptyTextProducesNothing()
    {
        Assert.Empty(ProofingTokenizer.Tokenize(string.Empty));
    }
}
