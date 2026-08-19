using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapsMnemoPayloadHandlerTests
{
    [Fact]
    public async Task RoundTrip_RestoresMapWithSameIdAndNodes()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        var map = (await source.Service.CreateAsync("Alpha", new[]
        {
            new MindmapNodeSpec { Text = "R", Children = new[] { new MindmapNodeSpec { Text = "C" } } },
        })).Value!;

        var result = await RoundTripAsync(source, target);

        Assert.Equal(1, result.ImportedCount);
        var restored = (await target.Service.GetAsync(map.Id)).Value!;
        Assert.Equal("Alpha", restored.Title);
        Assert.Equal(2, restored.Elements.Count(e => e.Kind == ElementKind.Node));
    }

    [Fact]
    public async Task RoundTrip_RestoresFolderMembership()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("f1", "Folder", null, 0));
        var map = (await source.Service.CreateAsync("Alpha")).Value!;
        await source.Service.MoveToFolderAsync(map.Id, "f1");

        await RoundTripAsync(source, target);

        var folders = (await target.Service.GetFoldersAsync()).Value!;
        Assert.Contains(folders, f => f.Id == "f1" && f.Name == "Folder");
        var entry = (await target.Service.GetLibraryAsync()).Value!.Single(e => e.Document.Id == map.Id);
        Assert.Equal("f1", entry.FolderId);
    }

    [Fact]
    public async Task Import_MapIdCollision_RegeneratesIdAndKeepsElementIds()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        var map = (await source.Service.CreateAsync("Alpha", new[] { new MindmapNodeSpec { Text = "R" } })).Value!;
        var files = (await ExportHandler(source).ExportAsync(Context())).Files;

        var first = await ImportAsync(target, files);
        var second = await ImportAsync(target, files); // identical map id → collision

        Assert.Equal(1, first.ImportedCount);
        Assert.Equal(1, second.DuplicatedCount);

        var summaries = (await target.Service.ListAsync()).Value!;
        Assert.Equal(2, summaries.Count);

        var original = (await target.Service.GetAsync(map.Id)).Value!;
        var duplicateId = summaries.Select(s => s.Id).Single(id => id != map.Id);
        var duplicate = (await target.Service.GetAsync(duplicateId)).Value!;
        Assert.Equal(
            original.Elements.Select(e => e.Id).OrderBy(x => x, StringComparer.Ordinal),
            duplicate.Elements.Select(e => e.Id).OrderBy(x => x, StringComparer.Ordinal));

        // The duplicate is renamed "Alpha (2)"-style so the library never shows two identical titles.
        Assert.Equal("Alpha", original.Title);
        Assert.Equal("Alpha (2)", duplicate.Title);
    }

    [Fact]
    public async Task Import_ReplacingAnOpenMap_MovesTheRevisionForwardAndAnnouncesItself()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        var map = (await source.Service.CreateAsync("Alpha", new[] { new MindmapNodeSpec { Text = "Imported" } })).Value!;
        var files = (await ExportHandler(source).ExportAsync(Context())).Files;

        // The target already holds a map of the same id, as it would after an export and a round trip back.
        await ImportAsync(target, files);
        var before = (await target.Service.GetAsync(map.Id)).Value!;

        MindmapChangedEventArgs? seen = null;
        target.Service.Changed += (_, e) => seen = e;
        var result = await ImportAsync(target, files, ImportConflictPolicy.Replace);

        Assert.Equal(1, result.ImportedCount);
        // An import is a write, not a store poke: the revision has to move so an editor open on the map
        // notices, and the notice has to carry enough for that editor to take the import back.
        var after = (await target.Service.GetAsync(map.Id)).Value!;
        Assert.True(after.Revision > before.Revision);
        Assert.NotNull(seen);
        Assert.Equal(map.Id, seen!.MapId);
        Assert.NotNull(seen.Change);
        Assert.Equal(before.Revision, seen.Change!.BaseRevision);
    }

    [Fact]
    public async Task Import_ReplacingAMap_MakesAnEditComposedBeforeItConflict()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        var map = (await source.Service.CreateAsync("Alpha", new[] { new MindmapNodeSpec { Text = "R" } })).Value!;
        var files = (await ExportHandler(source).ExportAsync(Context())).Files;
        await ImportAsync(target, files);

        // The user has been editing their copy, so the incoming package genuinely disagrees with it.
        var imported = (await target.Service.GetAsync(map.Id)).Value!;
        var rootId = imported.Elements.Single().Id;
        await target.Service.ApplyAsync(map.Id, imported.Revision, new MindmapEditOp[] { new SetOp { Id = rootId, Text = "user typed this" } });
        var before = (await target.Service.GetAsync(map.Id)).Value!;

        await ImportAsync(target, files, ImportConflictPolicy.Replace);

        // The batch the user was composing when the import landed names an element the import rewrote, so
        // it is refused rather than rebased onto a document that no longer resembles the one it was for.
        var stale = (await target.Service.ApplyAsync(map.Id, before.Revision, new MindmapEditOp[]
        {
            new SetOp { Id = rootId, Text = "and then this" },
        })).Value!;

        Assert.False(stale.Success);
        Assert.Equal(MindmapEditErrorCode.RevConflict, stale.Error!.Code);
        Assert.Contains(rootId, stale.Error.ContendedIds!);
    }

    [Fact]
    public async Task RoundTrip_EmbedsAndRestoresUserTemplate()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Store.SaveStyleTemplateAsync(new StyleTemplate { Id = "user-x", Name = "My Template" });
        await source.Service.CreateAsync("Alpha", null, null, "user-x");

        await RoundTripAsync(source, target);

        var templates = await target.Store.GetStyleTemplatesAsync();
        Assert.Contains(templates, t => t.Id == "user-x" && t.Name == "My Template");
    }

    [Fact]
    public async Task Import_TemplateIdExistsLocally_KeepsLocalTemplate()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Store.SaveStyleTemplateAsync(new StyleTemplate { Id = "user-x", Name = "Imported" });
        await source.Service.CreateAsync("Alpha", null, null, "user-x");
        await target.Store.SaveStyleTemplateAsync(new StyleTemplate { Id = "user-x", Name = "Local" });

        await RoundTripAsync(source, target);

        var kept = (await target.Store.GetStyleTemplatesAsync()).Single(t => t.Id == "user-x");
        Assert.Equal("Local", kept.Name);
    }

    [Fact]
    public async Task Export_MissingImageAsset_DoesNotThrow()
    {
        await using var source = new MindmapTestHarness();
        var map = (await source.Service.CreateAsync("Alpha")).Value!;
        await source.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp { Kind = ElementKind.Image, X = 0, Y = 0, Content = new CanvasImageContent { AssetId = $"gone-{Guid.NewGuid():N}.png" } },
        });

        var export = await ExportHandler(source).ExportAsync(Context());

        Assert.True(export.Files.ContainsKey("mindmaps.db"));
        Assert.Equal(1, export.ItemCount);
        Assert.DoesNotContain(export.Files.Keys, k => k.StartsWith("assets/images/", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Export_SelectedMapIds_ExportsOnlySelected()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        var keep = (await source.Service.CreateAsync("Keep")).Value!;
        await source.Service.CreateAsync("Drop");

        var options = new MnemoPackageExportOptions();
        options.PayloadOptions["mindmaps.mapIds"] = new[] { keep.Id };
        var export = await ExportHandler(source).ExportAsync(new MnemoPayloadExportContext { Options = options });
        Assert.Equal(1, export.ItemCount);

        await ImportAsync(target, export.Files);
        var titles = (await target.Service.ListAsync()).Value!.Select(m => m.Title).ToList();
        Assert.Equal(new[] { "Keep" }, titles);
    }

    [Fact]
    public async Task RoundTrip_SelectedMapInANestedFolder_RestoresTheWholeChain()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("f2", "Rocks", "f1", 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("f3", "Igneous", "f2", 0));
        var map = (await source.Service.CreateAsync("Alpha", folderId: "f3")).Value!;

        // A selective export walks each map's folder upward, so the package lists the chain child first.
        var options = new MnemoPackageExportOptions();
        options.PayloadOptions["mindmaps.mapIds"] = new[] { map.Id };
        var export = await ExportHandler(source).ExportAsync(new MnemoPayloadExportContext { Options = options });
        await ImportAsync(target, export.Files);

        var folders = (await target.Service.GetFoldersAsync()).Value!;
        Assert.Equal("f2", folders.Single(f => f.Id == "f3").ParentId);
        Assert.Equal("f1", folders.Single(f => f.Id == "f2").ParentId);
        Assert.Null(folders.Single(f => f.Id == "f1").ParentId);
    }

    [Fact]
    public async Task Import_NestedFoldersCollideUnderKeepBoth_NestsTheCopiesTheSameWay()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("f2", "Rocks", "f1", 0));
        var map = (await source.Service.CreateAsync("Alpha", folderId: "f2")).Value!;
        var files = (await ExportHandler(source).ExportAsync(Context())).Files;

        await ImportAsync(target, files);
        await ImportAsync(target, files); // same folder ids as the first import, so every one collides

        var folders = (await target.Service.GetFoldersAsync()).Value!;
        Assert.Equal(4, folders.Count);

        // The second copy of the subfolder sits under the second copy of its parent, not under the first.
        var copiedChild = folders.Single(f => f.Name == "Rocks" && f.Id != "f2");
        var copiedParent = folders.Single(f => f.Name == "Geology" && f.Id != "f1");
        Assert.Equal(copiedParent.Id, copiedChild.ParentId);

        // And the map that came with it is in the copy rather than in the user's original.
        var copiedMap = (await target.Service.ListAsync()).Value!.Single(m => m.Id != map.Id);
        var entry = (await target.Service.GetLibraryAsync()).Value!.Single(e => e.Document.Id == copiedMap.Id);
        Assert.Equal(copiedChild.Id, entry.FolderId);
    }

    [Fact]
    public async Task Import_PayloadFromANewerBuild_IsRefusedRatherThanReadAnyway()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.CreateAsync("Alpha");
        var files = (await ExportHandler(source).ExportAsync(Context())).Files;

        var result = await ImportAsync(target, files, schemaVersion: 2);

        // Reading a layout this build has never seen imports whatever happens to line up and drops the
        // rest, which leaves the user with maps that look restored and are not.
        Assert.Equal(0, result.ImportedCount);
        Assert.Empty((await target.Service.ListAsync()).Value!);
        Assert.Contains(result.Warnings, w => w.Contains("newer version", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Import_UnreadablePayloadDatabase_WarnsInsteadOfThrowing()
    {
        await using var target = new MindmapTestHarness();
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["mindmaps.db"] = "this is not a database"u8.ToArray(),
        };

        var result = await ImportAsync(target, files);

        // The package holds decks and notes beside the mindmaps, and they are still perfectly readable.
        Assert.Equal(0, result.ImportedCount);
        Assert.NotEmpty(result.Warnings);
    }

    [Fact]
    public async Task Import_OneUnreadableMapRow_StillImportsTheRest()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.CreateAsync("Alpha");
        var good = (await source.Service.CreateAsync("Beta")).Value!;
        var files = (await ExportHandler(source).ExportAsync(Context())).Files;
        files["mindmaps.db"] = DamageOneMap(files["mindmaps.db"], keepId: good.Id);

        var result = await ImportAsync(target, files);

        Assert.Equal(1, result.ImportedCount);
        Assert.Equal("Beta", (await target.Service.ListAsync()).Value!.Single().Title);
        Assert.NotEmpty(result.Warnings);
    }

    private static MindmapsMnemoPayloadHandler ExportHandler(MindmapTestHarness h) =>
        new(h.Service, h.Store, new TestLogger());

    private static MnemoPayloadExportContext Context() =>
        new() { Options = new MnemoPackageExportOptions() };

    private static Task<MnemoPayloadImportResult> ImportAsync(
        MindmapTestHarness target,
        IReadOnlyDictionary<string, byte[]> files,
        ImportConflictPolicy policy = ImportConflictPolicy.KeepBoth,
        int schemaVersion = 1) =>
        new MindmapsMnemoPayloadHandler(target.Service, target.Store, new TestLogger()).ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "mindmaps", Path = "payloads/mindmaps", SchemaVersion = schemaVersion },
            Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
            Files = files,
        });

    /// <summary>Replaces every stored document except one with json that does not parse.</summary>
    private static byte[] DamageOneMap(byte[] database, string keepId)
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo-mm-damage-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(path, database);
            using (var connection = new SqliteConnection($"Data Source={path};Pooling=False"))
            {
                connection.Open();
                using var command = connection.CreateCommand();
                command.CommandText = "UPDATE Maps SET Json = '{\"schemaVersion\":2,' WHERE MapId <> $keep";
                command.Parameters.AddWithValue("$keep", keepId);
                command.ExecuteNonQuery();
            }

            return File.ReadAllBytes(path);
        }
        finally
        {
            try { File.Delete(path); } catch (IOException) { }
        }
    }

    private static async Task<MnemoPayloadImportResult> RoundTripAsync(
        MindmapTestHarness source, MindmapTestHarness target, ImportConflictPolicy policy = ImportConflictPolicy.KeepBoth)
    {
        var export = await ExportHandler(source).ExportAsync(Context());
        return await ImportAsync(target, export.Files, policy);
    }
}
