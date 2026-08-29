using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Checks removal of package image tokens and preservation of unmatched bare filenames.
/// </summary>
public sealed class FlashcardPackageImageTokenTests
{
    private const string AlicePath = @"C:\Users\alice\AppData\Local\Mnemo\images\9f2.png";
    private const string AliceParenthesisedPath = @"C:\Users\alice (2)\AppData\Local\Mnemo\images\9f2.png";

    [Fact]
    public async Task Restore_PackageWrittenOnAnotherMachine_DropsTheTokenNamingItsPicture()
    {
        // Use a literal Windows path to exercise cross-platform separator handling.
        var card = await RestoreSingleCardAsync($"Cell?\n\n![a diagram]({AlicePath})", "9f2.png");

        Assert.Equal("Cell?", card.Front);
    }

    [Fact]
    public async Task Restore_TokenWhoseNameTheGrammarCannotReach_StillLosesTheAccountItNames()
    {
        // A closing parenthesis truncates the matched path before its filename. The unmatched
        // suffix remains in the card text.
        var card = await RestoreSingleCardAsync($"Cell?\n\n![a diagram]({AliceParenthesisedPath})", "9f2.png");

        Assert.DoesNotContain("alice", card.Front, StringComparison.Ordinal);
        Assert.DoesNotContain(@"C:\Users", card.Front, StringComparison.Ordinal);
        Assert.StartsWith("Cell?", card.Front, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RoundTrip_TypedImageTextBesideARealAttachment_IsLeftAlone()
    {
        var imagesDirectory = FlashcardPackageFixture.NewImagesDirectory();
        var imagePath = Path.Combine(imagesDirectory, "diagram.png");
        await File.WriteAllBytesAsync(imagePath, new byte[64]);

        await using var source = new FlashcardStoreHarness();
        var sourceLibrary = NewLibrary(source);
        var sourceCards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Facts, source.Clock);

        var deck = await sourceLibrary.CreateDeckAsync("Biology");
        var attachment = new FlashcardAttachment(
            Guid.NewGuid().ToString("N"), FlashcardAttachment.FrontSide, imagePath, "diagram.png", 64, "a diagram");
        await sourceCards.CreateCardsAsync(deck.Id, new[]
        {
            new FlashcardCardDraft(
                deck.Id, FlashcardType.Classic, "Cell?\n\n![see fig 4](fig4)", "Unit of life",
                Array.Empty<string>(), new[] { attachment })
        });

        var export = await FlashcardPackageFixture.Handler(source, imagesDirectory)
            .ExportAsync(new MnemoPayloadExportContext { Options = new MnemoPackageExportOptions() });

        await using var target = new FlashcardStoreHarness();
        await target.Store.InitializeAsync();
        var targetLibrary = NewLibrary(target);
        var targetCards = new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Facts, target.Clock);

        await FlashcardPackageFixture.Handler(target, FlashcardPackageFixture.NewImagesDirectory())
            .ImportAsync(ImportContext(export.Files));

        var importedDeck = Assert.Single(await targetLibrary.ListDecksAsync());
        var page = await targetCards.ListCardsAsync(new FlashcardCardQuery(importedDeck.Id));
        var card = Assert.Single(page.Items).Card;

        // Unmatched bare filenames must remain unchanged.
        Assert.Contains("![see fig 4](fig4)", card.Front, StringComparison.Ordinal);
        Assert.DoesNotContain("diagram.png", card.Front, StringComparison.Ordinal);
        Assert.Single(card.Attachments);
    }

    /// <summary>
    /// Restores a hand-built package so the exporter cannot normalize the token under test.
    /// </summary>
    private static async Task<Flashcard> RestoreSingleCardAsync(string front, string packagedFileName)
    {
        var snapshot = new FlashcardPayloadSnapshot();
        snapshot.Decks.Add(new DeckSnapshotDto
        {
            Id = "deck-from-elsewhere",
            Name = "Biology",
            Cards = new List<CardSnapshotDto>
            {
                new()
                {
                    Id = "card-from-elsewhere",
                    DeckId = "deck-from-elsewhere",
                    Front = front,
                    Back = "Unit of life",
                    Type = (int)FlashcardType.Classic,
                    DueDate = DateTimeOffset.UtcNow,
                    Attachments = new List<AttachmentSnapshotDto>
                    {
                        new()
                        {
                            Id = "attachment-from-elsewhere",
                            Side = FlashcardAttachment.FrontSide,
                            FileName = packagedFileName,
                            DisplayName = packagedFileName,
                            SizeBytes = 64,
                            Caption = "a diagram",
                        },
                    },
                },
            },
        });

        await using var h = new FlashcardStoreHarness();
        await h.Store.InitializeAsync();
        var library = NewLibrary(h);
        var cards = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Facts, h.Clock);

        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
        {
            [FlashcardPayloadDatabase.FileName] = FlashcardPayloadDatabase.Write(snapshot),
        };

        var import = await FlashcardPackageFixture.Handler(h).ImportAsync(ImportContext(files));
        Assert.Equal(1, import.ImportedCount);

        var deck = Assert.Single(await library.ListDecksAsync());
        var page = await cards.ListCardsAsync(new FlashcardCardQuery(deck.Id));
        return Assert.Single(page.Items).Card;
    }

    private static MnemoPayloadImportContext ImportContext(IReadOnlyDictionary<string, byte[]> files) => new()
    {
        Entry = new MnemoPackageEntry { PayloadType = "flashcards", Path = "flashcards" },
        Options = new MnemoPackageImportOptions { ConflictPolicy = ImportConflictPolicy.KeepBoth },
        Files = new Dictionary<string, byte[]>(files, StringComparer.OrdinalIgnoreCase),
    };

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);
}
