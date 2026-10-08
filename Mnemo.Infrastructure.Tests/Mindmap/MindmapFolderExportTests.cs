using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>How a mind map package carries a folder out, and where an import puts it back.</summary>
public sealed class MindmapFolderExportTests
{
    [Fact]
    public async Task FolderExport_KeepsEmptySubfoldersAndLeavesItsParentsBehind()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("sci", "Science", null, 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", "sci", 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("rocks", "Rocks", "geo", 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("empty", "Empty", "geo", 1));
        var map = (await source.Service.CreateAsync("Alpha", folderId: "rocks")).Value!;

        var export = await Handler(source).ExportAsync(Selection([map.Id], ["geo"]));
        var result = await ImportAsync(target, export, MnemoPackageKinds.Export);

        var folders = (await target.Service.GetFoldersAsync()).Value!.ToDictionary(f => f.Id);
        Assert.Equal(["empty", "geo", "rocks"], folders.Keys.Order(StringComparer.Ordinal));
        Assert.Null(folders["geo"].ParentId);
        Assert.Equal("geo", folders["rocks"].ParentId);
        Assert.Equal("geo", folders["empty"].ParentId);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task FolderExport_AMapPickedOutsideTheFolder_KeepsItsWholeChain()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("sci", "Science", null, 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", "sci", 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("art", "Art", null, 1));
        await source.Service.SaveFolderAsync(new MindmapFolder("paint", "Painting", "art", 0));
        var inside = (await source.Service.CreateAsync("Inside", folderId: "geo")).Value!;
        var outside = (await source.Service.CreateAsync("Outside", folderId: "paint")).Value!;

        var export = await Handler(source).ExportAsync(Selection([inside.Id, outside.Id], ["geo"]));
        await ImportAsync(target, export, MnemoPackageKinds.Export);

        var folders = (await target.Service.GetFoldersAsync()).Value!.ToDictionary(f => f.Id);
        Assert.Equal(["art", "geo", "paint"], folders.Keys.Order(StringComparer.Ordinal));
        Assert.Equal("art", folders["paint"].ParentId);
    }

    [Fact]
    public async Task FolderExport_ReplacedInTheSameLibrary_StaysWhereItIs()
    {
        await using var h = new MindmapTestHarness();
        await h.Service.SaveFolderAsync(new MindmapFolder("sci", "Science", null, 0));
        await h.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", "sci", 0));
        var map = (await h.Service.CreateAsync("Alpha", folderId: "geo")).Value!;

        var export = await Handler(h).ExportAsync(Selection([map.Id], ["geo"]));
        await ImportAsync(h, export, MnemoPackageKinds.Export, ImportConflictPolicy.Replace);

        var folders = (await h.Service.GetFoldersAsync()).Value!;
        Assert.Equal("sci", folders.Single(f => f.Id == "geo").ParentId);
    }

    [Fact]
    public async Task Backup_AFolderWhoseParentIsMissing_IsStillReported()
    {
        await using var source = new MindmapTestHarness();
        await using var target = new MindmapTestHarness();
        await source.Service.SaveFolderAsync(new MindmapFolder("sci", "Science", null, 0));
        await source.Service.SaveFolderAsync(new MindmapFolder("geo", "Geology", "sci", 0));
        var map = (await source.Service.CreateAsync("Alpha", folderId: "geo")).Value!;

        var export = await Handler(source).ExportAsync(Selection([map.Id], ["geo"]));
        var result = await ImportAsync(target, export, MnemoPackageKinds.Backup);

        Assert.Contains(result.Warnings, w => w.Key == "MindmapFolderRestoredAtRoot");
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
        MindmapTestHarness target,
        MnemoPayloadExportData export,
        string kind,
        ImportConflictPolicy policy = ImportConflictPolicy.KeepBoth) =>
        Handler(target).ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "mindmaps", Path = "payloads/mindmaps", SchemaVersion = export.SchemaVersion },
            Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
            Files = export.Files,
            Manifest = new MnemoPackageManifest { Kind = kind },
        });
}
