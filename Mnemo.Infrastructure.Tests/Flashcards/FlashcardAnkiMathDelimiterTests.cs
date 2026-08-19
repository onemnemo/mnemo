using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Anki fields spell maths in several ways; the card renderer reads one. An imported formula that
/// keeps its original delimiters is drawn as its own source text, so the user sees the backslashes.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiMathDelimiterTests
{
    [Theory]
    // The MathJax spellings Anki writes today.
    [InlineData(@"Solve \(x^2 + 1\) now", "Solve $x^2 + 1$ now")]
    [InlineData(@"Given \[\int_0^1 x\,dx\] we get", "Given $$\\int_0^1 x\\,dx$$ we get")]
    // The field syntax older collections carry.
    [InlineData(@"Given [$]e^{i\pi}[/$] here", @"Given $e^{i\pi}$ here")]
    [InlineData(@"Given [$$]\sum_n a_n[/$$] here", @"Given $$\sum_n a_n$$ here")]
    // Already in the dialect the renderer reads: left exactly as it is.
    [InlineData("Already $a + b$ fine", "Already $a + b$ fine")]
    // A delimiter without its partner is prose. Opening a formula here would swallow the rest of
    // the card, which is worse than the unconverted text.
    [InlineData(@"A stray \( with no closer", @"A stray \( with no closer")]
    [InlineData(@"A stray \] with no opener", @"A stray \] with no opener")]
    [InlineData(@"Unclosed [$] tag alone", @"Unclosed [$] tag alone")]
    public async Task Import_MathDelimiters_ArriveInTheDialectTheRendererReads(string fieldHtml, string expected)
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[] { new AnkiFixtureCard("Maths", fieldHtml, "back") },
            new Dictionary<string, byte[]>());

        try
        {
            Assert.Equal(expected, await ImportFrontAsync(apkg));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_InlineMathAcrossALineBreak_IsLeftAlone()
    {
        // Two unrelated lines that happen to hold one delimiter each. Pairing them across the break
        // would mark a whole paragraph as a formula.
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[] { new AnkiFixtureCard("Maths", @"opens with \( here<br>closes with \) there", "back") },
            new Dictionary<string, byte[]>());

        try
        {
            Assert.Equal("opens with \\( here\ncloses with \\) there", await ImportFrontAsync(apkg));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_TwoFormulasOnOneLine_KeepsThemSeparate()
    {
        // A greedy match would fuse the two into one formula holding the prose between them.
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[] { new AnkiFixtureCard("Maths", @"\(a\) and \(b\)", "back") },
            new Dictionary<string, byte[]>());

        try
        {
            Assert.Equal("$a$ and $b$", await ImportFrontAsync(apkg));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    private static async Task<string> ImportFrontAsync(string apkg)
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
        var adapter = new FlashcardsAnkiFormatAdapter(
            library, cardService, new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock), new ImageAssetService());

        var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(result.Success, result.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync());
        var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        return Assert.Single(page.Items).Card.Front;
    }
}
