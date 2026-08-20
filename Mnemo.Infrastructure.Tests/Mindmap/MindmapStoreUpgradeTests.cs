using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Opening a mindmap database written by an older build. Mirrors the flashcard store's own
/// upgrade coverage: CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so an
/// index added later reaches new installs and no existing one until the store's own migration step
/// runs.
/// </summary>
public sealed class MindmapStoreUpgradeTests
{
    [Fact]
    public async Task A_library_written_before_the_folder_live_index_keeps_its_folders_and_reads_them_back_live()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_mm_v4_{Guid.NewGuid():N}.db");
        try
        {
            await using (var store = new MindmapStore(new TestLogger(), path))
            {
                await store.InitializeAsync();
                await store.SaveFolderAsync(new MindmapFolder("folder-1", "Geology", null, 0));
                await store.SaveFolderAsync(new MindmapFolder("folder-2", "Chemistry", null, 1));
            }

            await StripTheFolderLiveIndexAsync(path);

            IReadOnlyList<MindmapFolder> folders;
            await using (var reopened = new MindmapStore(new TestLogger(), path))
            {
                await reopened.InitializeAsync();
                folders = await reopened.GetFoldersAsync();
            }

            Assert.True(
                await IndexExistsAsync(path, "IX_MindmapFolders_Live"),
                "IX_MindmapFolders_Live is missing after opening a library written before it.");

            // Nothing in an existing library was ever deleted, so both folders come back exactly as
            // they were before the index was added.
            Assert.Contains(folders, f => f.Id == "folder-1" && f.Name == "Geology");
            Assert.Contains(folders, f => f.Id == "folder-2" && f.Name == "Chemistry");
        }
        finally
        {
            Delete(path);
        }
    }

    /// <summary>
    /// Takes the file back to what the build before the folder live index left behind: the index is
    /// dropped and the stamp is moved back, so reopening has real work to do.
    /// </summary>
    private static async Task StripTheFolderLiveIndexAsync(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            DROP INDEX IF EXISTS IX_MindmapFolders_Live;
            UPDATE MindmapSchemaVersion SET Version = 4;
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<bool> IndexExistsAsync(string path, string index)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = $name LIMIT 1;";
        cmd.Parameters.AddWithValue("$name", index);
        return await cmd.ExecuteScalarAsync() is not null;
    }

    private static void Delete(string path)
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
