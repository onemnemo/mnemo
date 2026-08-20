using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;
using Xunit.Abstractions;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Proves IX_MindmapFolders_Live actually changes the query plan <see cref="MindmapStore.GetFoldersAsync"/>
/// runs, and that dropping the index back out changes nothing about what the query returns.
/// </summary>
/// <remarks>
/// The store's migration step creates the index on every fresh database, so the "before" state
/// here is made by dropping it back out of a real, seeded database rather than by reverting the
/// schema, and both the indexed and un-indexed plan are captured from that same physical file in
/// the same test run. The query text below is copied from <see cref="MindmapStore.GetFoldersAsync"/>
/// verbatim; if that query changes shape, this file's copy needs to change with it.
/// </remarks>
public sealed class MindmapFolderLiveIndexPlanTests
{
    private const string FolderQuery =
        "SELECT Id, Name, ParentId, SortOrder FROM MindmapFolders WHERE TrashId IS NULL ORDER BY SortOrder;";

    private readonly ITestOutputHelper _output;

    public MindmapFolderLiveIndexPlanTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task Live_folder_listing_uses_the_index_and_returns_the_same_rows_with_or_without_it()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_mm_plan_{Guid.NewGuid():N}.db");
        try
        {
            await SeedAsync(path);

            // Present: the store's migration step creates the index on every fresh database.
            IReadOnlyList<MindmapFolder> afterRows;
            await using (var store = new MindmapStore(new TestLogger(), path))
            {
                await store.InitializeAsync();
                afterRows = await store.GetFoldersAsync();
            }
            var afterPlan = await CapturePlanAsync(path);

            await DropIndexAsync(path);

            // Absent: the same file, the same rows, with only the index physically gone.
            IReadOnlyList<MindmapFolder> beforeRows;
            await using (var store = new MindmapStore(new TestLogger(), path))
            {
                await store.InitializeAsync();
                beforeRows = await store.GetFoldersAsync();
            }
            var beforePlan = await CapturePlanAsync(path);

            _output.WriteLine("=== MindmapFolders: MindmapStore.GetFoldersAsync ===");
            _output.WriteLine("before (no IX_MindmapFolders_Live):");
            foreach (var line in beforePlan)
                _output.WriteLine("  " + line);
            _output.WriteLine("after (IX_MindmapFolders_Live present):");
            foreach (var line in afterPlan)
                _output.WriteLine("  " + line);

            var beforeText = string.Join(" | ", beforePlan);
            var afterText = string.Join(" | ", afterPlan);
            Assert.Contains("SCAN", beforeText);
            Assert.Contains("TEMP B-TREE", beforeText);
            Assert.Contains("IX_MindmapFolders_Live", afterText);
            Assert.DoesNotContain("TEMP B-TREE", afterText);

            // An index that changes results is a bug: same rows, same order, with or without it.
            Assert.Equal(beforeRows, afterRows);
        }
        finally
        {
            SqliteTestPools.ClearPoolFor(path);
            foreach (var file in new[] { path, path + "-wal", path + "-shm" })
            {
                try
                {
                    if (File.Exists(file))
                        File.Delete(file);
                }
                catch (IOException)
                {
                    // A leftover temp file is not worth failing a green run over.
                }
            }
        }
    }

    /// <summary>Two live folders with a SortOrder tie broken by nothing else, plus one held folder,
    /// so the filter has something real to exclude and the order is exactly what the index carries.</summary>
    private static async Task SeedAsync(string path)
    {
        await using var store = new MindmapStore(new TestLogger(), path);
        await store.InitializeAsync();
        await store.SaveFolderAsync(new MindmapFolder("folder-a", "Anatomy", null, 0));
        await store.SaveFolderAsync(new MindmapFolder("folder-b", "Biology", null, 1));
        await store.SaveFolderAsync(new MindmapFolder("folder-c", "Chemistry", null, 2));

        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE MindmapFolders SET TrashId = 'trash-1' WHERE Id = 'folder-c';";
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<IReadOnlyList<string>> CapturePlanAsync(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "EXPLAIN QUERY PLAN " + FolderQuery;

        var lines = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            lines.Add(reader.GetString(3));
        return lines;
    }

    private static async Task DropIndexAsync(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DROP INDEX IF EXISTS IX_MindmapFolders_Live;";
        await cmd.ExecuteNonQueryAsync();
    }
}
