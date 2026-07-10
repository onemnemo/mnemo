using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
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

    private static MindmapsMnemoPayloadHandler ExportHandler(MindmapTestHarness h) =>
        new(h.Service, h.Store, new TestLogger());

    private static MnemoPayloadExportContext Context() =>
        new() { Options = new MnemoPackageExportOptions() };

    private static Task<MnemoPayloadImportResult> ImportAsync(
        MindmapTestHarness target, IReadOnlyDictionary<string, byte[]> files, ImportConflictPolicy policy = ImportConflictPolicy.KeepBoth) =>
        new MindmapsMnemoPayloadHandler(target.Service, target.Store, new TestLogger()).ImportAsync(new MnemoPayloadImportContext
        {
            Entry = new MnemoPackageEntry { PayloadType = "mindmaps", Path = "payloads/mindmaps" },
            Options = new MnemoPackageImportOptions { ConflictPolicy = policy },
            Files = files,
        });

    private static async Task<MnemoPayloadImportResult> RoundTripAsync(
        MindmapTestHarness source, MindmapTestHarness target, ImportConflictPolicy policy = ImportConflictPolicy.KeepBoth)
    {
        var export = await ExportHandler(source).ExportAsync(Context());
        return await ImportAsync(target, export.Files, policy);
    }
}
