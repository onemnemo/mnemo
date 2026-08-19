using System;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapLibraryTests
{
    [Fact]
    public async Task Folders_SaveList_RoundTrips()
    {
        await using var h = new MindmapTestHarness();
        await h.Service.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Service.SaveFolderAsync(new MindmapFolder("f2", "Rocks", "f1", 1));

        var folders = (await h.Service.GetFoldersAsync()).Value!;

        Assert.Equal(2, folders.Count);
        Assert.Contains(folders, f => f.Id == "f2" && f.ParentId == "f1");
    }

    [Fact]
    public async Task DeleteFolder_CascadesSubfolders()
    {
        await using var h = new MindmapTestHarness();
        await h.Service.SaveFolderAsync(new MindmapFolder("f1", "Parent", null, 0));
        await h.Service.SaveFolderAsync(new MindmapFolder("f2", "Child", "f1", 0));

        await h.Service.DeleteFolderAsync("f1");

        Assert.Empty((await h.Service.GetFoldersAsync()).Value!);
    }

    [Fact]
    public async Task CreateInFolder_SurfacesInLibraryEntry()
    {
        await using var h = new MindmapTestHarness();
        await h.Service.SaveFolderAsync(new MindmapFolder("f1", "Folder", null, 0));
        var map = (await h.Service.CreateAsync("Map", folderId: "f1")).Value!;

        var entry = (await h.Service.GetLibraryAsync()).Value!.Single(e => e.Document.Id == map.Id);

        Assert.Equal("f1", entry.FolderId);
        Assert.Empty(entry.LinkedDeckIds);
    }

    [Fact]
    public async Task MoveToFolder_UpdatesMembership_ThenRoot()
    {
        await using var h = new MindmapTestHarness();
        await h.Service.SaveFolderAsync(new MindmapFolder("f1", "Folder", null, 0));
        var map = (await h.Service.CreateAsync("Map")).Value!;

        await h.Service.MoveToFolderAsync(map.Id, "f1");
        Assert.Equal("f1", (await h.Service.GetLibraryAsync()).Value!.Single().FolderId);

        await h.Service.MoveToFolderAsync(map.Id, null);
        Assert.Null((await h.Service.GetLibraryAsync()).Value!.Single().FolderId);
    }

    [Fact]
    public async Task GetLibrary_IncludesFullDocument_ForCountsAndPreviews()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Map")).Value!;
        await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp { Nodes = new[] { new MindmapNodeSpec { Text = "root" } } },
        });

        var entry = (await h.Service.GetLibraryAsync()).Value!.Single();

        Assert.Single(entry.Document.Elements);
    }

    [Fact]
    public async Task GetLibrary_OneUnreadableDocument_StillReturnsEveryOtherMap()
    {
        await using var h = new MindmapTestHarness();
        var damaged = (await h.Service.CreateAsync("Damaged")).Value!;
        var intact = (await h.Service.CreateAsync("Intact")).Value!;

        // A write half completed, a hand edited database or a build that stored a shape this one cannot
        // read all end up here: a row whose document does not parse.
        await h.DamageAsync("UPDATE Mindmaps SET Doc = '{\"schemaVersion\":2,\"elements\":[' WHERE Id = $id;", damaged.Id);

        var library = (await h.Service.GetLibraryAsync()).Value!;

        Assert.Equal(intact.Id, library.Single().Document.Id);
    }

    [Fact]
    public async Task GetLibrary_EveryDocumentUnreadable_ReturnsAnEmptyLibraryRatherThanFailing()
    {
        await using var h = new MindmapTestHarness();
        var only = (await h.Service.CreateAsync("Damaged")).Value!;
        await h.DamageAsync("UPDATE Mindmaps SET Doc = 'not json at all' WHERE Id = $id;", only.Id);

        var library = await h.Service.GetLibraryAsync();

        Assert.True(library.IsSuccess);
        Assert.Empty(library.Value!);
    }

    [Fact]
    public async Task GetLibrary_AMapFromANewerBuild_IsStillListedSoItCanBeSeenAndMoved()
    {
        await using var h = new MindmapTestHarness();
        var future = (await h.Service.CreateAsync("Future")).Value!;
        await h.DamageAsync(
            "UPDATE Mindmaps SET Doc = replace(Doc, '\"schemaVersion\":2', '\"schemaVersion\":9') WHERE Id = $id;",
            future.Id);

        var library = (await h.Service.GetLibraryAsync()).Value!;

        // The gallery is where a user renames, moves and deletes, so hiding the map would leave them no
        // way to act on it at all. Opening it is the operation that has to refuse, and it says why.
        Assert.Equal(future.Id, library.Single().Document.Id);
        var opened = await h.Service.GetAsync(future.Id);
        Assert.False(opened.IsSuccess);
        Assert.Contains("schema version 9", opened.ErrorMessage);
    }

    [Fact]
    public async Task GetLibrary_AMapUsingAShapeThisBuildCannotRead_LeavesEveryOtherMapListed()
    {
        await using var h = new MindmapTestHarness();
        var future = (await h.Service.CreateAsync("Future")).Value!;
        var intact = (await h.Service.CreateAsync("Intact")).Value!;

        // A newer build that adds an element kind writes a name this one has no case for.
        await h.DamageAsync(
            "UPDATE Mindmaps SET Doc = '{\"schemaVersion\":9,\"id\":\"future\",\"title\":\"Future\",\"elements\":[{\"id\":\"e1\",\"kind\":\"hologram\"}]}' WHERE Id = $id;",
            future.Id);

        var library = (await h.Service.GetLibraryAsync()).Value!;

        Assert.Equal(intact.Id, library.Single().Document.Id);
    }

    [Fact]
    public async Task List_DamagedTimestamp_KeepsTheMapInTheList()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("Map")).Value!;
        await h.DamageAsync("UPDATE Mindmaps SET ModifiedAt = 'whenever' WHERE Id = $id;", map.Id);

        var summaries = (await h.Service.ListAsync()).Value!;

        // The list sorts and labels by this date, so an unreadable one belongs at the bottom of the list
        // rather than costing the user the map.
        var summary = Assert.Single(summaries);
        Assert.Equal(map.Id, summary.Id);
        Assert.Equal(DateTime.MinValue, summary.ModifiedAt);
    }
}
