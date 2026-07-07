using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.MindmapV2;
using Xunit;

namespace Mnemo.Infrastructure.Tests.MindmapV2;

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
}
