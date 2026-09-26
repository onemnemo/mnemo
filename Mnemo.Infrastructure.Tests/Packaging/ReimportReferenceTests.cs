using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Services.Packaging;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Mindmap;
using Mnemo.Infrastructure.Tests.Notes;
using Mnemo.Infrastructure.Tests.Proofing;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Packaging;

/// <summary>
/// When an item in a package comes back under a fresh id because the trash holds its old one, the
/// other items in the package that refer to it have to follow it rather than keep pointing at the
/// trashed original.
/// </summary>
public sealed class ReimportReferenceTests
{
    [Theory]
    [InlineData(ImportConflictPolicy.KeepBoth)]
    [InlineData(ImportConflictPolicy.Skip)]
    [InlineData(ImportConflictPolicy.Replace)]
    public async Task A_map_note_node_follows_its_note_out_of_the_trash(ImportConflictPolicy policy)
    {
        await using var profile = new Profile();
        var note = await profile.AddNoteAsync("Rocks");
        var map = await profile.AddMapAsync(new NoteContent { NoteId = note.NoteId });
        using var package = await profile.ExportAsync();

        await profile.Notes.Store.CaptureNoteAsync(note.NoteId, "e1");
        await profile.Maps.Store.CaptureMapAsync(map.Id, "e2");
        await profile.ImportAsync(package, policy);

        var live = Assert.Single(await profile.Notes.Notes.GetAllNotesAsync());
        Assert.NotEqual(note.NoteId, live.NoteId);
        var node = Assert.Single(await profile.LiveNodesAsync<NoteContent>());
        Assert.Equal(live.NoteId, node.NoteId);
    }

    [Fact]
    public async Task A_sub_page_and_its_parent_follow_each_other_out_of_the_trash()
    {
        await using var profile = new Profile();
        var child = new Note { NoteId = Guid.NewGuid().ToString(), Title = "Child" };
        var parent = new Note
        {
            NoteId = Guid.NewGuid().ToString(),
            Title = "Parent",
            Blocks = [new Block { Type = BlockType.Page, Payload = new PagePayload(child.NoteId) }],
        };
        child.ParentNoteId = parent.NoteId;
        Assert.True((await profile.Notes.Notes.SaveNoteAsync(parent)).IsSuccess);
        Assert.True((await profile.Notes.Notes.SaveNoteAsync(child)).IsSuccess);
        using var package = await profile.ExportAsync();

        await profile.Notes.Store.CaptureNoteAsync(child.NoteId, "e1");
        await profile.Notes.Store.CaptureNoteAsync(parent.NoteId, "e2");
        await profile.ImportAsync(package, ImportConflictPolicy.KeepBoth);

        var notes = await profile.Notes.Notes.GetAllNotesAsync();
        var liveParent = Assert.Single(notes, n => n.Title == "Parent");
        var liveChild = Assert.Single(notes, n => n.Title == "Child");
        Assert.NotEqual(parent.NoteId, liveParent.NoteId);
        Assert.NotEqual(child.NoteId, liveChild.NoteId);
        var page = Assert.IsType<PagePayload>(Assert.Single(liveParent.Blocks!, b => b.Type == BlockType.Page).Payload);
        Assert.Equal(liveChild.NoteId, page.ReferenceNoteId);
        Assert.Equal(liveParent.NoteId, liveChild.ParentNoteId);
    }

    [Fact]
    public async Task A_map_flashcard_node_follows_its_deck_and_card_out_of_the_trash()
    {
        await using var profile = new Profile();
        await profile.Cards.SeedDeckAsync();
        await profile.Cards.AddCardAsync(
            FlashcardStoreHarness.Card("c1", "deck-1", "gg", "ggg"),
            FlashcardSchedule.NewFor("c1", profile.Cards.Time.GetUtcNow()));
        var map = await profile.AddMapAsync(new FlashcardContent { DeckId = "deck-1", CardId = "c1" });
        using var package = await profile.ExportAsync();

        await new FlashcardDeckTrashSource(profile.Cards.Store).CaptureAsync("deck-1", "e1");
        await profile.Maps.Store.CaptureMapAsync(map.Id, "e2");
        await profile.ImportAsync(package, ImportConflictPolicy.KeepBoth);

        var deck = Assert.Single(await profile.Cards.Store.ReadAsync((conn, ct) => profile.Cards.Decks.ListHeadersAsync(conn, ct)));
        var card = Assert.Single(await profile.Cards.Store.ReadAsync((conn, ct) => profile.Cards.Cards.ListByDeckAsync(conn, deck.Id, ct)));
        Assert.NotEqual("deck-1", deck.Id);
        Assert.NotEqual("c1", card.Id);

        var node = Assert.Single(await profile.LiveNodesAsync<FlashcardContent>());
        Assert.Equal(deck.Id, node.DeckId);
        Assert.Equal(card.Id, node.CardId);
    }

    [Fact]
    public async Task Nothing_is_rewritten_when_nothing_was_renamed()
    {
        await using var source = new Profile();
        var note = await source.AddNoteAsync("Rocks");
        var child = new Note
        {
            NoteId = Guid.NewGuid().ToString(),
            Title = "Child",
            ParentNoteId = note.NoteId,
            Blocks = [new Block { Type = BlockType.Page, Payload = new PagePayload(note.NoteId) }],
        };
        Assert.True((await source.Notes.Notes.SaveNoteAsync(child)).IsSuccess);
        await source.Cards.SeedDeckAsync();
        await source.Cards.AddCardAsync(
            FlashcardStoreHarness.Card("c1", "deck-1", "gg", "ggg"),
            FlashcardSchedule.NewFor("c1", source.Cards.Time.GetUtcNow()));
        await source.AddMapAsync(
            new NoteContent { NoteId = note.NoteId },
            new FlashcardContent { DeckId = "deck-1", CardId = "c1" },
            new NoteContent { NoteId = "a-note-the-package-does-not-carry" });
        using var package = await source.ExportAsync();

        await using var target = new Profile();
        await target.ImportAsync(package, ImportConflictPolicy.KeepBoth);

        var notes = await target.Notes.Notes.GetAllNotesAsync();
        Assert.Contains(notes, n => n.NoteId == note.NoteId);
        var liveChild = Assert.Single(notes, n => n.NoteId == child.NoteId);
        Assert.Equal(note.NoteId, liveChild.ParentNoteId);
        Assert.Equal(note.NoteId, Assert.IsType<PagePayload>(Assert.Single(liveChild.Blocks!, b => b.Type == BlockType.Page).Payload).ReferenceNoteId);

        var noteNodeIds = (await target.LiveNodesAsync<NoteContent>()).Select(n => n.NoteId).ToList();
        Assert.Equal(2, noteNodeIds.Count);
        Assert.Contains(note.NoteId, noteNodeIds);
        Assert.Contains("a-note-the-package-does-not-carry", noteNodeIds);
        var flashcardNode = Assert.Single(await target.LiveNodesAsync<FlashcardContent>());
        Assert.Equal(("deck-1", "c1"), (flashcardNode.DeckId, flashcardNode.CardId));
    }

    /// <summary>One installation with notes, flashcards and maps, and the package service over all three.</summary>
    private sealed class Profile : IAsyncDisposable
    {
        public Profile()
        {
            Service = new MnemoPackageService(
                new IMnemoPayloadHandler[]
                {
                    new NotesMnemoPayloadHandler(Notes.Notes, Notes.Folders, Notes.Store),
                    FlashcardPackageFixture.Handler(Cards),
                    new MindmapsMnemoPayloadHandler(Maps.Service, Maps.Store, Maps.Store, new TestLogger()),
                },
                new MemorySettings(),
                new TestLogger());
        }

        public NoteSidMigrationHarness Notes { get; } = new();

        public FlashcardStoreHarness Cards { get; } = new();

        public MindmapTestHarness Maps { get; } = new();

        public MnemoPackageService Service { get; }

        public async Task<Note> AddNoteAsync(string title)
        {
            var note = new Note { NoteId = Guid.NewGuid().ToString(), Title = title };
            Assert.True((await Notes.Notes.SaveNoteAsync(note)).IsSuccess);
            return note;
        }

        public async Task<MindmapDocument> AddMapAsync(params IElementContent[] contents)
        {
            var created = await Maps.Service.CreateAsync("Alpha", new[]
            {
                new MindmapNodeSpec
                {
                    Text = "R",
                    Children = contents.Select(c => new MindmapNodeSpec { Content = c }).ToArray(),
                },
            });
            Assert.True(created.IsSuccess, created.ErrorMessage);
            return created.Value!;
        }

        public async Task<PackageFile> ExportAsync()
        {
            var file = new PackageFile();
            var export = await Service.ExportAsync(file.Path, new MnemoPackageExportOptions());
            Assert.True(export.IsSuccess, export.ErrorMessage);
            return file;
        }

        public async Task ImportAsync(PackageFile package, ImportConflictPolicy policy)
        {
            var import = await Service.ImportAsync(package.Path, new MnemoPackageImportOptions { ConflictPolicy = policy });
            Assert.True(import.IsSuccess, import.ErrorMessage);
            Assert.Empty(import.Value!.Warnings);
        }

        /// <summary>The contents of type <typeparamref name="T"/> across every map the library lists.</summary>
        public async Task<IReadOnlyList<T>> LiveNodesAsync<T>() where T : IElementContent
        {
            var library = (await Maps.Service.GetLibraryAsync()).Value!;
            return library.SelectMany(e => e.Document.Elements).Select(e => e.Content).OfType<T>().ToList();
        }

        public async ValueTask DisposeAsync()
        {
            await Maps.DisposeAsync();
            await Cards.DisposeAsync();
            await Notes.DisposeAsync();
        }
    }

    private sealed class PackageFile : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"mnemo-reimport-refs-{Guid.NewGuid():N}.mnemo");

        public void Dispose()
        {
            if (File.Exists(Path))
                File.Delete(Path);
        }
    }
}
