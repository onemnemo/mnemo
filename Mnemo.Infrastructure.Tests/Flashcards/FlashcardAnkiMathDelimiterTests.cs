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

    [Theory]
    // The dialect cards are written in here, back into the one the receiving app draws.
    [InlineData("Solve $x^2 + 1$ now", @"Solve \(x^2 + 1\) now")]
    [InlineData(@"Given $$\int_0^1 x\,dx$$ we get", @"Given \[\int_0^1 x\,dx\] we get")]
    [InlineData("Two $a$ and $b$ formulas", @"Two \(a\) and \(b\) formulas")]
    // Not maths and never was. A lone dollar is a price, and pairing it with the next one would
    // put half a sentence inside a formula.
    [InlineData("Costs 5 dollars", "Costs 5 dollars")]
    [InlineData("A stray $ with no partner", "A stray $ with no partner")]
    public async Task Export_MathInTheDialectCardsAreWrittenIn_ShipsInTheOneAnkiDraws(string cardText, string expected)
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_math_{Guid.NewGuid():N}.apkg");
        try
        {
            Assert.Equal(expected, await ExportFrontAsync(apkg, cardText));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task ExportThenImport_MathComesBackInTheDialectTheRendererReads()
    {
        // Left in dollars a re-exported card stops rendering as maths in the other app; rewritten
        // and then not read back it would come home as backslashes. Both halves or neither.
        const string CardText = "Inline $x^2$ and block $$\\int_0^1 x\\,dx$$ together";
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_math_{Guid.NewGuid():N}.apkg");
        try
        {
            var exported = await ExportFrontAsync(apkg, CardText);
            Assert.Equal(@"Inline \(x^2\) and block \[\int_0^1 x\,dx\] together", exported);
            Assert.Equal(CardText, await ImportFrontAsync(apkg));
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    /// <summary>Writes one card out and returns the question field the package actually holds.</summary>
    private static async Task<string> ExportFrontAsync(string apkg, string cardText)
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = NewAdapter(h, library, cardService);

        var deck = await library.CreateDeckAsync("Maths");
        await cardService.CreateCardsAsync(deck.Id, new[]
        {
            new FlashcardCardDraft(
                deck.Id, FlashcardType.Classic, cardText, "back",
                Array.Empty<string>(), Array.Empty<FlashcardAttachment>()),
        });

        var export = await adapter.ExportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(export.Success, export.ErrorMessage);

        var contents = await AnkiPackageInspector.ReadAsync(apkg);
        return Assert.Single(contents.Notes).Fields[0];
    }

    private static async Task<string> ImportFrontAsync(string apkg)
    {
        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
        var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);
        var adapter = NewAdapter(h, library, cardService);

        var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
        Assert.True(result.Success, result.ErrorMessage);

        var deck = Assert.Single(await library.ListDecksAsync());
        var page = await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        return Assert.Single(page.Items).Card.Front;
    }

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        FlashcardCardService cardSvc) =>
        new(library, cardSvc, h.FactService,
            new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock),
            new FlashcardReviewHistoryService(h.Store, h.Reviews), new ImageAssetService(AnkiPackageFixture.NewImagesDirectory()));
}
