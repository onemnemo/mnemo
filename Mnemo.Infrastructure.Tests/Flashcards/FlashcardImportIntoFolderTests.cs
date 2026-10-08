using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Where a flashcards import puts things when it is opened on a folder.</summary>
public sealed class FlashcardImportIntoFolderTests
{
    [Fact]
    public async Task Package_IntoAFolder_HangsItsTopLevelAndLooseDecksUnderIt()
    {
        await using var source = new FlashcardStoreHarness();
        await SeedAsync(source, [Folder("lang", "Languages"), Folder("es", "Spanish", "lang"), Folder("verbs", "Verbs", "es")],
            [("d1", "verbs"), ("loose", null)]);
        var exported = await FlashcardPackageFixture.Handler(source).ExportAsync(Selection(["d1", "loose"], ["es"]));

        await using var target = new FlashcardStoreHarness();
        await SeedAsync(target, [Folder("dest", "Destination")], []);
        await FlashcardPackageFixture.Handler(target).ImportAsync(Into(exported, ImportConflictPolicy.KeepBoth, "dest"));

        var folders = await FoldersAsync(target);
        Assert.Equal("dest", folders["es"].ParentId);
        Assert.Equal("es", folders["verbs"].ParentId);
        var decks = await DecksAsync(target);
        Assert.Equal("verbs", decks["d1"].FolderId);
        Assert.Equal("dest", decks["loose"].FolderId);
    }

    [Fact]
    public async Task Package_ReplaceIntoAFolder_MovesNothingThatAlreadyExists()
    {
        await using var h = new FlashcardStoreHarness();
        await SeedAsync(h, [Folder("lang", "Languages"), Folder("es", "Spanish", "lang"), Folder("dest", "Destination")],
            [("d1", "es"), ("loose", null)]);
        var handler = FlashcardPackageFixture.Handler(h);
        var exported = await handler.ExportAsync(Selection(["d1", "loose"], ["es"]));
        await SeedAsync(h, [], [("d1", "lang"), ("loose", "lang")]);

        await handler.ImportAsync(Into(exported, ImportConflictPolicy.Replace, "dest"));

        var folders = await FoldersAsync(h);
        Assert.Equal(3, folders.Count);
        Assert.Equal("lang", folders["es"].ParentId);
        var decks = await DecksAsync(h);
        Assert.Equal("lang", decks["d1"].FolderId);
        Assert.Equal("lang", decks["loose"].FolderId);
    }

    [Fact]
    public async Task Package_SkipIntoAFolder_LeavesTheLibraryAlone()
    {
        await using var h = new FlashcardStoreHarness();
        await SeedAsync(h, [Folder("lang", "Languages"), Folder("es", "Spanish", "lang"), Folder("dest", "Destination")],
            [("d1", "es")]);
        var handler = FlashcardPackageFixture.Handler(h);
        var exported = await handler.ExportAsync(Selection(["d1"], ["es"]));

        var result = await handler.ImportAsync(Into(exported, ImportConflictPolicy.Skip, "dest"));

        Assert.Equal(1, result.SkippedCount);
        Assert.Equal(3, (await FoldersAsync(h)).Count);
        Assert.Equal("lang", (await FoldersAsync(h))["es"].ParentId);
    }

    [Fact]
    public async Task Package_IntoAFolderThatIsGone_LandsAtTheTop()
    {
        await using var source = new FlashcardStoreHarness();
        await SeedAsync(source, [Folder("es", "Spanish")], [("d1", "es")]);
        var exported = await FlashcardPackageFixture.Handler(source).ExportAsync(Selection(["d1"], ["es"]));

        await using var target = new FlashcardStoreHarness();
        var result = await FlashcardPackageFixture.Handler(target).ImportAsync(Into(exported, ImportConflictPolicy.KeepBoth, "deleted"));

        Assert.Equal(1, result.ImportedCount);
        Assert.Null((await FoldersAsync(target))["es"].ParentId);
    }

    [Fact]
    public async Task DeckPaths_ResolveBelowTheBase_AndReuseItsFolders()
    {
        await using var h = new FlashcardStoreHarness();
        await SeedAsync(h, [Folder("dest", "Destination"), Folder("top", "A")], []);
        var library = new FlashcardLibraryService(
            h.Store, h.Folders, h.Decks, h.Cards, h.Facts, h.Schedules, h.Reviews, h.DailyStats, h.Presets, h.Clock);

        var first = await DeckFolderResolver.CreateAsync(library, CancellationToken.None, "dest");
        var (folderId, name) = await first.ResolvePathAsync("A::B::Deck", CancellationToken.None);
        var (plainFolder, _) = await first.ResolvePathAsync("Plain", CancellationToken.None);

        // A second import builds no parallel tree under the base, and never reuses the top-level "A".
        var second = await DeckFolderResolver.CreateAsync(library, CancellationToken.None, "dest");
        var (again, _) = await second.ResolvePathAsync("A::B::Other", CancellationToken.None);

        var folders = await FoldersAsync(h);
        Assert.Equal("Deck", name);
        Assert.Equal("dest", plainFolder);
        Assert.Equal(folderId, again);
        Assert.Equal("B", folders[folderId!].Name);
        var a = folders[folders[folderId!].ParentId!];
        Assert.Equal("A", a.Name);
        Assert.Equal("dest", a.ParentId);
        Assert.Equal(4, folders.Count);
    }

    private static FlashcardFolder Folder(string id, string name, string? parentId = null) => new(id, name, parentId, 0);

    private static MnemoPayloadExportContext Selection(string[] deckIds, string[] folderIds)
    {
        var options = new MnemoPackageExportOptions { Kind = MnemoPackageKinds.Export };
        options.PayloadOptions[MnemoPayloadOptionKeys.DeckIds] = deckIds;
        options.PayloadOptions[MnemoPayloadOptionKeys.DeckFolderIds] = folderIds;
        return new MnemoPayloadExportContext { Options = options };
    }

    private static MnemoPayloadImportContext Into(MnemoPayloadExportData exported, ImportConflictPolicy policy, string target)
    {
        var context = FlashcardPackageFixture.ImportContext(exported, policy);
        context.Options.PayloadOptions[MnemoPayloadOptionKeys.DeckTargetFolderId] = target;
        return context;
    }

    private static async Task SeedAsync(FlashcardStoreHarness h, FlashcardFolder[] folders, (string Id, string? FolderId)[] decks)
    {
        var now = DateTimeOffset.UtcNow;
        await h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await h.Presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now), ct);
            foreach (var folder in folders)
                await h.Folders.UpsertAsync(conn, tx, folder, now, ct);
            foreach (var (id, folderId) in decks)
            {
                await h.Decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                    id, folderId, FlashcardPreset.StandardPresetId, id, null, Array.Empty<string>(), 0, null, null, now, now), ct);
            }
        });
    }

    private static async Task<Dictionary<string, FlashcardFolder>> FoldersAsync(FlashcardStoreHarness h) =>
        (await h.Store.ReadAsync((conn, ct) => h.Folders.ListAsync(conn, ct))).ToDictionary(f => f.Id, StringComparer.Ordinal);

    private static async Task<Dictionary<string, FlashcardDeckHeader>> DecksAsync(FlashcardStoreHarness h) =>
        (await h.Store.ReadAsync((conn, ct) => h.Decks.ListHeadersAsync(conn, ct))).ToDictionary(d => d.Id, StringComparer.Ordinal);
}
