using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>Where a mind map import puts things when it is opened on a folder.</summary>
public sealed class MindmapImportIntoFolderTests
{
    [Fact]
    public async Task Package_IntoAFolder_HangsItsTopLevelAndLooseMapsUnderIt()
    {
        await using var source = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("sci", "Science", null, 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", "sci", 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("rocks", "Rocks", "geo", 0));
        var inside = (await source.Service.CreateAsync("Inside", folderId: "rocks")).Value!;
        var loose = (await source.Service.CreateAsync("Loose")).Value!;
        var export = await Handler(source).ExportAsync(Selection([inside.Id, loose.Id], ["geo"]));

        await using var target = new MindmapTestHarness();
        await target.Service.SaveFolderAsync(new MindmapFolder("dest", "Destination", null, 0));
        var result = await ImportAsync(target, export, ImportConflictPolicy.KeepBoth, "dest");

        var folders = (await target.Service.GetFoldersAsync()).Value!.ToDictionary(f => f.Id);
        Assert.Equal("dest", folders["geo"].ParentId);
        Assert.Equal("geo", folders["rocks"].ParentId);
        var library = (await target.Service.GetLibraryAsync()).Value!.ToDictionary(e => e.Document.Id);
        Assert.Equal("rocks", library[inside.Id].FolderId);
        Assert.Equal("dest", library[loose.Id].FolderId);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task Package_ReplaceIntoAFolder_MovesNothingThatAlreadyExists()
    {
        await using var h = new MindmapTestHarness();
        await h.Service.SaveFolderAsync(new MindmapFolder("sci", "Science", null, 0));
        await h.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", "sci", 0));
        await h.Service.SaveFolderAsync(new MindmapFolder("dest", "Destination", null, 1));
        var map = (await h.Service.CreateAsync("Alpha", folderId: "geo")).Value!;
        var loose = (await h.Service.CreateAsync("Loose")).Value!;
        var export = await Handler(h).ExportAsync(Selection([map.Id, loose.Id], ["geo"]));
        await h.Service.MoveToFolderAsync(map.Id, "sci");
        await h.Service.MoveToFolderAsync(loose.Id, "sci");

        await ImportAsync(h, export, ImportConflictPolicy.Replace, "dest");

        var folders = (await h.Service.GetFoldersAsync()).Value!;
        Assert.Equal(3, folders.Count);
        Assert.Equal("sci", folders.Single(f => f.Id == "geo").ParentId);
        var library = (await h.Service.GetLibraryAsync()).Value!.ToDictionary(e => e.Document.Id);
        Assert.Equal(2, library.Count);
        Assert.Equal("sci", library[map.Id].FolderId);
        Assert.Equal("sci", library[loose.Id].FolderId);
    }

    [Fact]
    public async Task Package_SkipIntoAFolder_LeavesTheLibraryAlone()
    {
        await using var h = new MindmapTestHarness();
        await h.Service.SaveFolderAsync(new MindmapFolder("sci", "Science", null, 0));
        await h.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", "sci", 0));
        await h.Service.SaveFolderAsync(new MindmapFolder("dest", "Destination", null, 1));
        var map = (await h.Service.CreateAsync("Alpha", folderId: "geo")).Value!;
        var export = await Handler(h).ExportAsync(Selection([map.Id], ["geo"]));

        var result = await ImportAsync(h, export, ImportConflictPolicy.Skip, "dest");

        Assert.Equal(1, result.SkippedCount);
        var folders = (await h.Service.GetFoldersAsync()).Value!;
        Assert.Equal(3, folders.Count);
        Assert.Equal("sci", folders.Single(f => f.Id == "geo").ParentId);
        Assert.Equal("geo", Assert.Single((await h.Service.GetLibraryAsync()).Value!).FolderId);
    }

    [Fact]
    public async Task Package_IntoAFolderThatIsGone_LandsAtTheRoot()
    {
        await using var source = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", null, 0));
        var map = (await source.Service.CreateAsync("Alpha", folderId: "geo")).Value!;
        var export = await Handler(source).ExportAsync(Selection([map.Id], ["geo"]));

        await using var target = new MindmapTestHarness();
        var result = await ImportAsync(target, export, ImportConflictPolicy.KeepBoth, "deleted");

        Assert.Equal(1, result.ImportedCount);
        Assert.Null((await target.Service.GetFoldersAsync()).Value!.Single().ParentId);
    }

    private static MindmapsMnemoPayloadHandler Handler(MindmapTestHarness h) =>
        new(h.Service, h.Store, h.Store, new TestLogger());

    private static MnemoPayloadExportContext Selection(string[] mapIds, string[] folderIds)
    {
        var options = new MnemoPackageExportOptions();
        options.PayloadOptions[MnemoPayloadOptionKeys.MapIds] = mapIds;
        options.PayloadOptions[MnemoPayloadOptionKeys.MapFolderIds] = folderIds;
        return new MnemoPayloadExportContext { Options = options };
    }

    private static Task<MnemoPayloadImportResult> ImportAsync(
        MindmapTestHarness target, MnemoPayloadExportData export, ImportConflictPolicy policy, string targetFolderId)
    {
        var options = new MnemoPackageImportOptions { ConflictPolicy = policy };
        options.PayloadOptions[MnemoPayloadOptionKeys.MapTargetFolderId] = targetFolderId;
        return Handler(target).ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "mindmaps", Path = "payloads/mindmaps", SchemaVersion = export.SchemaVersion },
            Options = options,
            Files = export.Files,
            Manifest = new MnemoPackageManifest { Kind = MnemoPackageKinds.Export },
        });
    }
}
