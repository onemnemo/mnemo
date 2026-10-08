using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Tests.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>How a flashcards package carries a deck folder out, and where an import puts it back.</summary>
public sealed class FlashcardFolderExportTests
{
    [Fact]
    public async Task FolderExport_KeepsEmptyAndIntermediateFolders()
    {
        await using var source = new FlashcardStoreHarness();
        await SeedAsync(source,
            [Folder("lang", "Languages"), Folder("es", "Spanish", "lang"), Folder("verbs", "Verbs", "es"),
             Folder("empty", "Empty", "es"), Folder("other", "Other")],
            [("d1", "verbs"), ("d2", "other")]);

        var exported = await FlashcardPackageFixture.Handler(source).ExportAsync(Selection(["d1"], ["es"]));
        await using var target = new FlashcardStoreHarness();
        await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(exported));

        var folders = await FoldersAsync(target);
        Assert.Equal(["empty", "es", "verbs"], folders.Keys.Order(StringComparer.Ordinal));
        // Spanish was under Languages, which the export does not carry, so it arrives at the top.
        Assert.Null(folders["es"].ParentId);
        Assert.Equal("es", folders["verbs"].ParentId);
        Assert.Equal("es", folders["empty"].ParentId);
    }

    [Fact]
    public async Task DeckExport_FromANestedFolder_ImportsIntoAnotherLibrary()
    {
        // The package carries the deck's own folder, whose parent it does not carry. Writing that
        // parent as it was would point the row at a folder this library does not have.
        await using var source = new FlashcardStoreHarness();
        await SeedAsync(source, [Folder("lang", "Languages"), Folder("es", "Spanish", "lang")], [("d1", "es")]);

        var exported = await FlashcardPackageFixture.Handler(source).ExportAsync(Selection(["d1"], []));
        await using var target = new FlashcardStoreHarness();
        var result = await FlashcardPackageFixture.Handler(target).ImportAsync(FlashcardPackageFixture.ImportContext(exported));

        Assert.Equal(1, result.ImportedCount);
        var folder = Assert.Single((await FoldersAsync(target)).Values);
        Assert.Null(folder.ParentId);
    }

    [Fact]
    public async Task FolderExport_ReplacedInTheSameLibrary_StaysWhereItIs()
    {
        await using var h = new FlashcardStoreHarness();
        await SeedAsync(h, [Folder("lang", "Languages"), Folder("es", "Spanish", "lang")], [("d1", "es")]);
        var handler = FlashcardPackageFixture.Handler(h);

        var exported = await handler.ExportAsync(Selection(["d1"], ["es"]));
        await handler.ImportAsync(FlashcardPackageFixture.ImportContext(exported, ImportConflictPolicy.Replace));

        Assert.Equal("lang", (await FoldersAsync(h))["es"].ParentId);
    }

    [Fact]
    public async Task KeepBoth_AChildListedBeforeItsParentFollowsTheCopy()
    {
        // Sort orders put the child ahead of its parent in the package.
        await using var h = new FlashcardStoreHarness();
        await SeedAsync(h, [Folder("top", "Top", order: 5), Folder("sub", "Sub", "top", order: 0)], [("d1", "sub")]);
        var handler = FlashcardPackageFixture.Handler(h);

        var exported = await handler.ExportAsync(Selection(["d1"], ["top"]));
        await handler.ImportAsync(FlashcardPackageFixture.ImportContext(exported));

        var folders = (await FoldersAsync(h)).Values.ToList();
        Assert.Equal(4, folders.Count);
        var topCopy = folders.Single(f => f.Name == "Top" && f.Id != "top");
        var subCopy = folders.Single(f => f.Name == "Sub" && f.Id != "sub");
        Assert.Equal(topCopy.Id, subCopy.ParentId);
    }

    [Fact]
    public async Task Export_RefusesASelectionThatIsNotACollectionOfIds()
    {
        await using var h = new FlashcardStoreHarness();
        await h.SeedDeckAsync();
        var options = new MnemoPackageExportOptions { Kind = MnemoPackageKinds.Export };
        options.PayloadOptions[MnemoPayloadOptionKeys.DeckIds] = "deck-1";

        await Assert.ThrowsAsync<ArgumentException>(() =>
            FlashcardPackageFixture.Handler(h).ExportAsync(new MnemoPayloadExportContext { Options = options }));
    }

    private static FlashcardFolder Folder(string id, string name, string? parentId = null, int order = 0) =>
        new(id, name, parentId, order);

    private static MnemoPayloadExportContext Selection(string[] deckIds, string[] folderIds)
    {
        var options = new MnemoPackageExportOptions { Kind = MnemoPackageKinds.Export };
        options.PayloadOptions[MnemoPayloadOptionKeys.DeckIds] = deckIds;
        options.PayloadOptions[MnemoPayloadOptionKeys.DeckFolderIds] = folderIds;
        return new MnemoPayloadExportContext { Options = options };
    }

    private static async Task SeedAsync(FlashcardStoreHarness h, FlashcardFolder[] folders, (string Id, string FolderId)[] decks)
    {
        var now = DateTimeOffset.UtcNow;
        await h.Store.WriteAsync(async (conn, tx, ct) =>
        {
            await h.Presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now), ct);
            foreach (var folder in folders.OrderBy(f => f.ParentId is null ? 0 : 1))
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
}
