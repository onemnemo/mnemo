using System;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapIntegrityServiceTests
{
    [Fact]
    public async Task Sweep_DanglingNoteRef_Reported()
    {
        await using var h = new MindmapTestHarness();
        var mapId = await SeedAsync(h, new MindmapNodeSpec { Content = new NoteContent { NoteId = "missing-note" } });
        var service = new MindmapIntegrityService(h.Service, new FakeNoteService(), new FakeDeckLibrary(), new TestLogger());

        var report = await service.SweepAsync(mapId);

        Assert.True(report.IsSuccess);
        var issue = Assert.Single(report.Value!.Issues);
        Assert.Equal(MindmapIntegrityIssueKind.MissingNote, issue.Kind);
        Assert.Equal("missing-note", issue.TargetId);
    }

    [Fact]
    public async Task Sweep_DanglingDeckRef_Reported()
    {
        await using var h = new MindmapTestHarness();
        var mapId = await SeedAsync(h, new MindmapNodeSpec { Content = new FlashcardContent { DeckId = "missing-deck" } });
        var service = new MindmapIntegrityService(h.Service, new FakeNoteService(), new FakeDeckLibrary(), new TestLogger());

        var report = await service.SweepAsync(mapId);

        Assert.True(report.IsSuccess);
        var issue = Assert.Single(report.Value!.Issues);
        Assert.Equal(MindmapIntegrityIssueKind.MissingDeck, issue.Kind);
        Assert.Equal("missing-deck", issue.TargetId);
    }

    [Fact]
    public async Task Sweep_MissingImageAsset_Reported()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        var assetId = $"gone-{Guid.NewGuid():N}.png";
        await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddElementOp { Kind = ElementKind.Image, X = 0, Y = 0, Content = new CanvasImageContent { AssetId = assetId } },
        });
        var service = new MindmapIntegrityService(h.Service, new FakeNoteService(), new FakeDeckLibrary(), new TestLogger());

        var report = await service.SweepAsync(map.Id);

        Assert.True(report.IsSuccess);
        var issue = Assert.Single(report.Value!.Issues);
        Assert.Equal(MindmapIntegrityIssueKind.MissingImageAsset, issue.Kind);
        Assert.Equal(assetId, issue.TargetId);
    }

    [Fact]
    public async Task Sweep_CleanDocument_NoIssues()
    {
        await using var h = new MindmapTestHarness();
        var map = (await h.Service.CreateAsync("M")).Value!;
        await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[]
        {
            new AddNodesOp
            {
                Nodes = new[]
                {
                    new MindmapNodeSpec { Content = new NoteContent { NoteId = "n1" } },
                    new MindmapNodeSpec { Content = new FlashcardContent { DeckId = "d1" } },
                },
            },
        });
        var notes = new FakeNoteService("n1");
        var decks = new FakeDeckLibrary("d1");
        var service = new MindmapIntegrityService(h.Service, notes, decks, new TestLogger());

        var report = await service.SweepAsync(map.Id);

        Assert.True(report.IsSuccess);
        Assert.Empty(report.Value!.Issues);
        Assert.Equal(map.Id, report.Value.MapId);
    }

    [Fact]
    public async Task Sweep_UnknownMap_Fails()
    {
        await using var h = new MindmapTestHarness();
        var service = new MindmapIntegrityService(h.Service, new FakeNoteService(), new FakeDeckLibrary(), new TestLogger());

        var report = await service.SweepAsync("no-such-map");

        Assert.False(report.IsSuccess);
    }

    private static async Task<string> SeedAsync(MindmapTestHarness h, MindmapNodeSpec spec)
    {
        var map = (await h.Service.CreateAsync("M")).Value!;
        await h.Service.ApplyAsync(map.Id, map.Revision, new MindmapEditOp[] { new AddNodesOp { Nodes = new[] { spec } } });
        return map.Id;
    }
}
