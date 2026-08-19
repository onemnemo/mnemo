using Microsoft.Data.Sqlite;
using Mnemo.Core.Enums;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Host.Mindmap;
using Xunit;

namespace Mnemo.Host.Tests.Mindmap;

/// <summary>
/// What the mindmap module answers when asked which uploaded images are still in use, and what a
/// sweep built on that answer does to a directory of them.
/// <para>
/// The whole policy rests on this being complete and on it refusing to answer when it is not sure.
/// An image it fails to name is deleted out from under a map that still draws it, and there is no
/// second chance: the bytes are gone.
/// </para>
/// </summary>
public sealed class MindmapAssetReclamationTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), "mnemo-mindmap-assets", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_directory))
            Directory.Delete(_directory, recursive: true);
    }

    [Fact]
    public async Task AnImageOnTheCanvasCountsAsReferenced()
    {
        await using var h = new MindmapHostHarness();
        await MapWithCanvasImageAsync(h, "canvas.png");

        var referenced = await new MindmapAssetReferenceSource(h.Store).CollectReferencedIdsAsync();

        Assert.Contains("canvas.png", referenced);
    }

    [Fact]
    public async Task AnImageInsideANodeCountsAsReferenced()
    {
        await using var h = new MindmapHostHarness();
        await MapWithNodeImageAsync(h, "node.png");

        var referenced = await new MindmapAssetReferenceSource(h.Store).CollectReferencedIdsAsync();

        Assert.Contains("node.png", referenced);
    }

    [Fact]
    public async Task ADesktopEraAbsolutePathIsNotReportedAsAManagedAsset()
    {
        // It names a file in the shared directory, which nothing sweeps, so reporting it would only
        // protect a file that was never at risk.
        await using var h = new MindmapHostHarness();
        var absolute = Path.Combine(Path.GetTempPath(), "elsewhere", "old.png");
        await MapWithCanvasImageAsync(h, absolute);

        var referenced = await new MindmapAssetReferenceSource(h.Store).CollectReferencedIdsAsync();

        Assert.Empty(referenced);
    }

    [Fact]
    public async Task AMapThatCannotBeReadStopsTheAnswerRatherThanShorteningIt()
    {
        // The library read skips a row it cannot parse so one damaged map cannot empty the gallery.
        // Here that would be a map whose images look unreferenced, and the sweep would delete them.
        await using var h = new MindmapHostHarness();
        var map = await MapWithCanvasImageAsync(h, "canvas.png");
        await DamageAsync(h, map.Id);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => new MindmapAssetReferenceSource(h.Store).CollectReferencedIdsAsync());
    }

    [Fact]
    public async Task ASweepKeepsTheImageAMapShowsAndReclaimsTheOneNothingNames()
    {
        await using var h = new MindmapHostHarness();
        await MapWithCanvasImageAsync(h, "kept.png");
        var kept = WriteOldFile("kept.png");
        var orphan = WriteOldFile("orphan.png");

        var result = await Sweeper(h).SweepAsync();

        Assert.True(result.Swept);
        Assert.True(File.Exists(kept));
        Assert.False(File.Exists(orphan));
    }

    [Fact]
    public async Task ASweepLeavesAFreshUploadAloneUntilTheDocumentReferencingItIsSaved()
    {
        await using var h = new MindmapHostHarness();
        var inFlight = WriteFreshFile("just-uploaded.png");

        var result = await Sweeper(h).SweepAsync();

        Assert.True(result.Swept);
        Assert.True(File.Exists(inFlight));
    }

    [Fact]
    public async Task ASweepDeletesNothingWhenAMapCannotBeRead()
    {
        await using var h = new MindmapHostHarness();
        var map = await MapWithCanvasImageAsync(h, "kept.png");
        var orphan = WriteOldFile("orphan.png");
        await DamageAsync(h, map.Id);

        await Assert.ThrowsAsync<InvalidOperationException>(() => Sweeper(h).SweepAsync());

        Assert.True(File.Exists(orphan));
    }

    // ---- Plumbing ----------------------------------------------------------------------------

    private AssetSweeper Sweeper(MindmapHostHarness h) =>
        new(
            new ManagedAssetStore(() => _directory, ManagedAssetStore.ImageExtensions),
            [new MindmapAssetReferenceSource(h.Store)],
            new AssetSessionRegistry(),
            new NullLogger(),
            TimeSpan.FromMinutes(30));

    /// <summary>A map holding one image dropped on the canvas.</summary>
    private static Task<MindmapDocument> MapWithCanvasImageAsync(MindmapHostHarness h, string assetId) =>
        MapWithAsync(h, new AddElementOp
        {
            Kind = ElementKind.Image,
            X = 0,
            Y = 0,
            Content = new CanvasImageContent { AssetId = assetId },
        });

    /// <summary>A map holding one tree node whose body is an image.</summary>
    private static Task<MindmapDocument> MapWithNodeImageAsync(MindmapHostHarness h, string assetId) =>
        MapWithAsync(h, new AddNodesOp
        {
            Nodes = new[] { new MindmapNodeSpec { Content = new ImageContent { AssetId = assetId } } },
        });

    private static async Task<MindmapDocument> MapWithAsync(MindmapHostHarness h, MindmapEditOp op)
    {
        var map = (await h.Service.CreateAsync("M")).Value!;
        var applied = await h.Service.ApplyAsync(map.Id, map.Revision, new[] { op });
        Assert.True(applied.IsSuccess && applied.Value!.Success, "the seed edit did not apply");
        return (await h.Service.GetAsync(map.Id)).Value!;
    }

    /// <summary>Puts a row in the database that no write path would produce.</summary>
    private static async Task DamageAsync(MindmapHostHarness h, string mapId)
    {
        await using var connection = new SqliteConnection($"Data Source={h.DatabasePath}");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Mindmaps SET Doc = 'not json at all' WHERE Id = $id;";
        command.Parameters.AddWithValue("$id", mapId);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>A file old enough to be outside the grace window.</summary>
    private string WriteOldFile(string name)
    {
        var path = WriteFreshFile(name);
        var old = DateTime.UtcNow - TimeSpan.FromDays(2);
        File.SetCreationTimeUtc(path, old);
        File.SetLastWriteTimeUtc(path, old);
        return path;
    }

    private string WriteFreshFile(string name)
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, name);
        File.WriteAllBytes(path, [1, 2, 3]);
        return path;
    }

    private sealed class NullLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
