using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>
/// Covers the shape of an imported collection: the deck tree, what a partly broken package leaves
/// behind, and the parts of a note the two sides of a card have no room for.
/// </summary>
[Collection(AnkiPackageFixture.TestCollection)]
public sealed class FlashcardAnkiDeckStructureTests
{
    [Fact]
    public async Task Import_NestedDeckName_BuildsTheFolderChain()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[] { new AnkiFixtureCard("Medicine::Cardiology::Arrhythmias", "AV block", "Conduction") },
            new Dictionary<string, byte[]>());

        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var adapter = NewAdapter(h, library, new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock));

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            // A flat deck literally named "Medicine::Cardiology::Arrhythmias" is what the user sees
            // when the separator is carried through instead of read.
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal("Arrhythmias", deck.Name);

            var folders = await library.ListFoldersAsync();
            var byId = folders.ToDictionary(f => f.Id, StringComparer.Ordinal);
            var leaf = Assert.Single(folders, f => f.Id == deck.Header.FolderId);
            Assert.Equal("Cardiology", leaf.Name);

            var root = byId[leaf.ParentId!];
            Assert.Equal("Medicine", root.Name);
            Assert.Null(root.ParentId);
            Assert.Equal(2, folders.Count);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_TheSameHierarchyTwice_ReusesTheFolders()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[]
            {
                new AnkiFixtureCard("Medicine::Cardiology", "AV block", "Conduction"),
                new AnkiFixtureCard("Medicine::Neurology", "Aphasia", "Broca"),
            },
            new Dictionary<string, byte[]>());

        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var adapter = NewAdapter(h, library, new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock));

            Assert.True((await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg })).Success);
            Assert.True((await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg })).Success);

            // Two decks per import, but one "Medicine" for all of them. Building the chain blindly
            // grows a parallel tree on every re-import.
            var folders = await library.ListFoldersAsync();
            Assert.Single(folders);
            Assert.Equal("Medicine", folders[0].Name);
            Assert.Equal(4, (await library.ListDecksAsync()).Count);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task ExportThenImport_KeepsTheDeckInsideItsFolders()
    {
        var apkg = Path.Combine(Path.GetTempPath(), $"mnemo_anki_export_{Guid.NewGuid():N}.apkg");

        try
        {
            await using (var source = new FlashcardStoreHarness())
            {
                await source.Store.InitializeAsync();
                var library = NewLibrary(source);
                var cards = new FlashcardCardService(source.Store, source.Cards, source.Schedules, source.Clock);

                await library.SaveFolderAsync(new FlashcardFolder("f-root", "Medicine", null, 0));
                await library.SaveFolderAsync(new FlashcardFolder("f-leaf", "Cardiology", "f-root", 1));
                var deck = await library.CreateDeckAsync("Arrhythmias", "f-leaf");
                await cards.CreateCardsAsync(deck.Id, new[]
                {
                    new FlashcardCardDraft(
                        deck.Id, FlashcardType.Classic, "AV block", "Conduction",
                        Array.Empty<string>(), Array.Empty<FlashcardAttachment>()),
                });

                var export = await NewAdapter(source, library, cards)
                    .ExportAsync(new ImportExportRequest { FilePath = apkg });
                Assert.True(export.Success, export.ErrorMessage);
            }

            await using var target = new FlashcardStoreHarness();
            await target.Store.InitializeAsync();
            var targetLibrary = NewLibrary(target);
            var targetAdapter = NewAdapter(target, targetLibrary, new FlashcardCardService(target.Store, target.Cards, target.Schedules, target.Clock));

            var import = await targetAdapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(import.Success, import.ErrorMessage);

            var imported = Assert.Single(await targetLibrary.ListDecksAsync());
            Assert.Equal("Arrhythmias", imported.Name);

            var folders = await targetLibrary.ListFoldersAsync();
            Assert.Equal(2, folders.Count);
            var leaf = Assert.Single(folders, f => f.Id == imported.Header.FolderId);
            Assert.Equal("Cardiology", leaf.Name);
            Assert.Equal("Medicine", Assert.Single(folders, f => f.Id == leaf.ParentId).Name);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_OneDeckThatWillNotSave_KeepsTheRestAndSaysSo()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[]
            {
                new AnkiFixtureCard("Good", "keep me", "fine"),
                new AnkiFixtureCard("Bad", FailingCardService.Poison, "boom"),
            },
            new Dictionary<string, byte[]>());

        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var cards = new FailingCardService(new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock));
            var adapter = NewAdapter(h, library, cards);

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });

            // The whole import used to fail on the first bad deck, so a retry duplicated everything
            // that had already landed.
            Assert.True(result.Success, result.ErrorMessage);
            Assert.Equal(1, result.ProcessedCounts["decks"]);
            Assert.Equal(1, result.ProcessedCounts["flashcards"]);
            Assert.Contains(result.Warnings, w => w.Contains("'Bad'", StringComparison.Ordinal));

            // The half-made deck is rolled back rather than left for the user to find and delete.
            var deck = Assert.Single(await library.ListDecksAsync());
            Assert.Equal("Good", deck.Name);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_NoteTypeWithMoreFieldsThanACardHas_WarnsOncePerNoteType()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[]
            {
                new AnkiFixtureCard("Vocab", "hund", "dog", ExtraFields: new[] { "der Hund", "noun" }),
                new AnkiFixtureCard("Vocab", "katze", "cat", ExtraFields: new[] { "die Katze", "noun" }),
            },
            new Dictionary<string, byte[]>());

        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var adapter = NewAdapter(h, library, new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock));

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            // Dropping the third and later fields silently reads as an import that worked.
            var warning = Assert.Single(result.Warnings, w => w.Contains("Basic", StringComparison.Ordinal));
            Assert.Contains("first two fields", warning, StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_CardReferencingAudio_SaysTheSoundWasNotImported()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[]
            {
                new AnkiFixtureCard("Listening", "Say it", "hola [sound:hola.mp3]"),
                new AnkiFixtureCard("Listening", "No audio here", "adios"),
            },
            new Dictionary<string, byte[]>());

        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var adapter = NewAdapter(h, library, new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock));

            var result = await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg });
            Assert.True(result.Success, result.ErrorMessage);

            // Leaving the reference on the card with nothing said reads as a rendering bug.
            var warning = Assert.Single(result.Warnings, w => w.Contains("audio", StringComparison.OrdinalIgnoreCase));
            Assert.StartsWith("1 card", warning, StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    [Fact]
    public async Task Import_ListAndTableMarkup_KeepsTheLineBreaks()
    {
        var apkg = await AnkiPackageFixture.WriteAsync(
            AnkiFixtureLayout.Legacy,
            new[]
            {
                new AnkiFixtureCard(
                    "Markup",
                    "<ul><li>one</li><li>two</li></ul>",
                    "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>"),
            },
            new Dictionary<string, byte[]>());

        try
        {
            await using var h = new FlashcardStoreHarness();
            await h.Store.InitializeAsync();
            var library = NewLibrary(h);
            var cardService = new FlashcardCardService(h.Store, h.Cards, h.Schedules, h.Clock);
            var adapter = NewAdapter(h, library, cardService);

            Assert.True((await adapter.ImportAsync(new ImportExportRequest { FilePath = apkg })).Success);

            var deck = Assert.Single(await library.ListDecksAsync());
            var card = Assert.Single((await cardService.ListCardsAsync(new FlashcardCardQuery(deck.Id))).Items).Card;

            // Stripping the tags without turning them into breaks runs a list into "onetwo".
            Assert.Equal("one\ntwo", card.Front);
            Assert.Equal(new[] { "a b", "c d" }, card.Back.Split('\n').Select(line => line.Trim()).ToArray());
        }
        finally
        {
            File.Delete(apkg);
        }
    }

    private static FlashcardsAnkiFormatAdapter NewAdapter(
        FlashcardStoreHarness h,
        FlashcardLibraryService library,
        IFlashcardCardService cardSvc) =>
        new(library, cardSvc, new FlashcardPresetService(h.Store, h.Presets, h.Decks, h.Clock), new ImageAssetService());

    private static FlashcardLibraryService NewLibrary(FlashcardStoreHarness h) =>
        new(h.Store, h.Folders, h.Decks, h.Cards, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

    /// <summary>
    /// Refuses one deck's worth of cards so a package can be partly broken. A real package fails the
    /// same way when a single note carries something the store rejects.
    /// </summary>
    private sealed class FailingCardService : IFlashcardCardService
    {
        public const string Poison = "refuse this deck";

        private readonly IFlashcardCardService _inner;

        public FailingCardService(IFlashcardCardService inner) => _inner = inner;

        public Task<IReadOnlyList<Flashcard>> CreateCardsAsync(
            string deckId, IReadOnlyList<FlashcardCardDraft> drafts, CancellationToken cancellationToken = default)
        {
            if (drafts.Any(d => string.Equals(d.Front, Poison, StringComparison.Ordinal)))
                throw new InvalidOperationException("this deck cannot be written");

            return _inner.CreateCardsAsync(deckId, drafts, cancellationToken);
        }

        public Task<FlashcardCardPage> ListCardsAsync(FlashcardCardQuery query, CancellationToken cancellationToken = default) =>
            _inner.ListCardsAsync(query, cancellationToken);

        public Task<Flashcard?> GetCardAsync(string cardId, CancellationToken cancellationToken = default) =>
            _inner.GetCardAsync(cardId, cancellationToken);

        public Task<Flashcard> CreateCardAsync(FlashcardCardDraft draft, CancellationToken cancellationToken = default) =>
            _inner.CreateCardAsync(draft, cancellationToken);

        public Task UpdateCardAsync(Flashcard card, CancellationToken cancellationToken = default) =>
            _inner.UpdateCardAsync(card, cancellationToken);

        public Task DeleteCardsAsync(IReadOnlyList<string> cardIds, CancellationToken cancellationToken = default) =>
            _inner.DeleteCardsAsync(cardIds, cancellationToken);

        public Task MoveCardsAsync(IReadOnlyList<string> cardIds, string targetDeckId, CancellationToken cancellationToken = default) =>
            _inner.MoveCardsAsync(cardIds, targetDeckId, cancellationToken);

        public Task SetSuspendedAsync(IReadOnlyList<string> cardIds, bool suspended, CancellationToken cancellationToken = default) =>
            _inner.SetSuspendedAsync(cardIds, suspended, cancellationToken);

        public Task SetFlaggedAsync(IReadOnlyList<string> cardIds, bool flagged, CancellationToken cancellationToken = default) =>
            _inner.SetFlaggedAsync(cardIds, flagged, cancellationToken);

        public Task AddTagAsync(IReadOnlyList<string> cardIds, string tag, CancellationToken cancellationToken = default) =>
            _inner.AddTagAsync(cardIds, tag, cancellationToken);

        public Task<IReadOnlyList<Flashcard>> SearchAsync(
            string query, FlashcardSearchScope scope, CancellationToken cancellationToken = default) =>
            _inner.SearchAsync(query, scope, cancellationToken);
    }
}
