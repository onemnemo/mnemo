using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// The mindmap store's side of the trash: what a held row is invisible to, what it survives, and what
/// a folder takes with it.
/// </summary>
public sealed class MindmapTrashTests
{
    [Fact]
    public async Task A_held_map_leaves_the_library_without_leaving_the_database()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", 1, Node("n1", "granite")));

        var snapshot = await h.Store.CaptureMapAsync("m1", "e1");

        Assert.NotNull(snapshot);
        Assert.Equal("Rock cycle", snapshot!.Title);
        Assert.Null(await h.Store.LoadAsync("m1"));
        Assert.Empty(await h.Store.ListAsync());
        Assert.Empty(await h.Store.GetLibraryAsync());
        Assert.NotNull(await h.Store.LoadAllOwnedAsync("m1"));
        Assert.Contains("m1", await h.Store.ListAllOwnedIdsAsync());
    }

    [Fact]
    public async Task A_held_map_stops_answering_searches()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "M", 1, Node("n1", "sediment")));

        await h.Store.CaptureMapAsync("m1", "e1");

        Assert.Empty(await h.Store.SearchAsync("m1", "sediment", 10));
    }

    [Fact]
    public async Task A_held_map_cannot_be_written_over()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Before", 1, Node("n1", "granite")));
        await h.Store.CaptureMapAsync("m1", "e1");

        await SaveAsync(h, Doc("m1", "After", 2, Node("n1", "basalt")));
        await h.Store.SetFolderAsync("m1", "f1");

        var stored = await h.Store.LoadAllOwnedAsync("m1");
        Assert.Equal("Before", stored!.Title);
        Assert.Equal(1, stored.Revision);
    }

    [Fact]
    public async Task Deleting_a_held_map_outright_is_refused()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "M", 1, Node("n1", "granite")));
        await h.Store.CaptureMapAsync("m1", "e1");

        await h.Store.DeleteAsync("m1");

        Assert.NotNull(await h.Store.LoadAllOwnedAsync("m1"));
    }

    [Fact]
    public async Task Preparing_a_map_reports_the_folder_it_would_come_back_to()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        await h.Store.SetFolderAsync("m1", "f1");

        var snapshot = await h.Store.PrepareMapAsync("m1");

        Assert.Equal("Rock cycle", snapshot!.Title);
        Assert.Equal("Geology", snapshot.Origin);
        Assert.Equal(0, snapshot.ContainedCount);
        Assert.Null(await h.Store.PrepareMapAsync("nope"));
    }

    [Fact]
    public async Task Restoring_a_map_puts_it_back_in_the_folder_it_came_from()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        await h.Store.SetFolderAsync("m1", "f1");
        await h.Store.CaptureMapAsync("m1", "e1");

        var restore = await h.Store.RestoreMapAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        Assert.Equal("f1", restore.DestinationId);
        Assert.Equal("Geology", restore.DestinationName);
        Assert.Single(await h.Store.ListAsync());
    }

    [Fact]
    public async Task A_map_whose_folder_went_away_comes_back_to_the_root()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        await h.Store.SetFolderAsync("m1", "f1");
        await h.Store.CaptureMapAsync("m1", "e1");
        await h.Store.DeleteFolderAsync("f1");

        var restore = await h.Store.RestoreMapAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Rooted, restore.Outcome);
        var library = await h.Store.GetLibraryAsync();
        Assert.Null(Assert.Single(library).FolderId);
    }

    [Fact]
    public async Task Restoring_an_entry_no_map_carries_reports_missing()
    {
        await using var h = new MindmapTestHarness();
        var restore = await h.Store.RestoreMapAsync("e1");
        Assert.Equal(TrashRestoreOutcome.Missing, restore.Outcome);
    }

    [Fact]
    public async Task Purging_a_map_destroys_it_and_queues_the_files_it_named()
    {
        await using var h = new MindmapTestHarness();
        var document = Doc("m1", "M", 1, Node("n1", "granite"), Image("n2", "picture.png"));
        await SaveAsync(h, document);
        await h.Store.CaptureMapAsync("m1", "e1");

        await h.Store.PurgeMapAsync("e1");

        Assert.Null(await h.Store.LoadAllOwnedAsync("m1"));
        Assert.Empty(await h.Store.ListAllOwnedIdsAsync());
        Assert.Equal(["picture.png"], await QueuedFilesAsync(h));
    }

    [Fact]
    public async Task A_purge_clears_the_search_rows_the_map_owned()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "M", 1, Node("n1", "sediment")));
        await h.Store.CaptureMapAsync("m1", "e1");

        await h.Store.PurgeMapAsync("e1");
        await SaveAsync(h, Doc("m1", "M again", 1));

        Assert.Empty(await h.Store.SearchAsync("m1", "sediment", 10));
    }

    [Fact]
    public async Task A_folder_takes_its_subtree_with_it()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Store.SaveFolderAsync(new MindmapFolder("f2", "Igneous", "f1", 0));
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        await SaveAsync(h, Doc("m2", "Granite", 1));
        await SaveAsync(h, Doc("m3", "Elsewhere", 1));
        await h.Store.SetFolderAsync("m1", "f1");
        await h.Store.SetFolderAsync("m2", "f2");

        var snapshot = await h.Store.CaptureFolderAsync("f1", "e1");

        Assert.Equal("Geology", snapshot!.Title);
        Assert.Equal(2, snapshot.ContainedCount);
        Assert.Empty(await h.Store.GetFoldersAsync());
        Assert.Equal(["m3"], (await h.Store.ListAsync()).Select(s => s.Id));
    }

    [Fact]
    public async Task A_folder_leaves_alone_what_another_entry_already_holds()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        await SaveAsync(h, Doc("m2", "Granite", 1));
        await h.Store.SetFolderAsync("m1", "f1");
        await h.Store.SetFolderAsync("m2", "f1");
        await h.Store.CaptureMapAsync("m1", "e1");

        var snapshot = await h.Store.CaptureFolderAsync("f1", "e2");

        Assert.Equal(1, snapshot!.ContainedCount);

        // The map is still recoverable, but not before the folder it would land in comes back.
        Assert.Equal(TrashRestoreOutcome.BlockedByContainer, (await h.Store.RestoreMapAsync("e1")).Outcome);
        await h.Store.RestoreFolderAsync("e2");
        Assert.Equal(TrashRestoreOutcome.Restored, (await h.Store.RestoreMapAsync("e1")).Outcome);
        Assert.Equal(2, (await h.Store.ListAsync()).Count);
    }

    [Fact]
    public async Task Restoring_a_folder_brings_the_whole_subtree_back()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Store.SaveFolderAsync(new MindmapFolder("f2", "Igneous", "f1", 0));
        await SaveAsync(h, Doc("m1", "Granite", 1));
        await h.Store.SetFolderAsync("m1", "f2");
        await h.Store.CaptureFolderAsync("f1", "e1");

        var restore = await h.Store.RestoreFolderAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        var folders = await h.Store.GetFoldersAsync();
        Assert.Equal(2, folders.Count);
        Assert.Equal("f1", folders.Single(f => f.Id == "f2").ParentId);
        Assert.Equal("f2", Assert.Single(await h.Store.GetLibraryAsync()).FolderId);
    }

    [Fact]
    public async Task Deleting_the_folder_above_a_held_one_does_not_destroy_it()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Store.SaveFolderAsync(new MindmapFolder("f2", "Igneous", "f1", 0));
        await SaveAsync(h, Doc("m1", "Granite", 1));
        await h.Store.SetFolderAsync("m1", "f2");
        await h.Store.CaptureFolderAsync("f2", "e1");

        // A live delete cascades to subfolders, which would take the held one with it.
        await h.Store.DeleteFolderAsync("f1");

        var restore = await h.Store.RestoreFolderAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Restored, restore.Outcome);
        var folder = Assert.Single(await h.Store.GetFoldersAsync());
        Assert.Equal("f2", folder.Id);
        Assert.Null(folder.ParentId);
        Assert.Equal("f2", Assert.Single(await h.Store.GetLibraryAsync()).FolderId);
    }

    [Fact]
    public async Task A_folder_whose_parent_row_went_away_comes_back_to_the_root()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Store.SaveFolderAsync(new MindmapFolder("f2", "Igneous", "f1", 0));
        await h.Store.CaptureFolderAsync("f2", "e1");

        // A parent that is simply gone, which is what an older database or a delete that ran without
        // foreign keys leaves behind.
        await h.DamageAsync("PRAGMA foreign_keys=OFF; DELETE FROM MindmapFolders WHERE Id = $id;", "f1");

        var restore = await h.Store.RestoreFolderAsync("e1");

        Assert.Equal(TrashRestoreOutcome.Rooted, restore.Outcome);
        Assert.Null(Assert.Single(await h.Store.GetFoldersAsync()).ParentId);
    }

    [Fact]
    public async Task Purging_a_folder_destroys_the_subtree_and_queues_its_files()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Store.SaveFolderAsync(new MindmapFolder("f2", "Igneous", "f1", 0));
        await SaveAsync(h, Doc("m1", "Granite", 1, Image("n1", "granite.png")));
        await h.Store.SetFolderAsync("m1", "f2");
        await h.Store.CaptureFolderAsync("f1", "e1");

        var purge = await h.Store.PurgeFolderAsync("e1");

        Assert.True(purge.Completed);
        Assert.Empty(await h.Store.ListAllOwnedIdsAsync());
        Assert.Empty(await h.Store.GetFoldersAsync());
        Assert.Equal(["granite.png"], await QueuedFilesAsync(h));
    }

    [Fact]
    public async Task A_folder_another_entry_reaches_into_is_not_destroyed_yet()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Store.SaveFolderAsync(new MindmapFolder("f2", "Igneous", "f1", 0));
        await h.Store.CaptureFolderAsync("f2", "child");
        await h.Store.CaptureFolderAsync("f1", "parent");

        var purge = await h.Store.PurgeFolderAsync("parent");

        Assert.False(purge.Completed);
        Assert.Equal(["child"], purge.BlockingEntryIds);
        Assert.True(await h.Store.FolderHoldsAsync("parent"));
    }

    [Fact]
    public async Task A_live_folder_under_a_purged_one_is_lifted_rather_than_orphaned()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await h.Store.CaptureFolderAsync("f1", "e1");
        await h.Store.SaveFolderAsync(new MindmapFolder("f2", "Igneous", "f1", 0));

        var purge = await h.Store.PurgeFolderAsync("e1");

        Assert.True(purge.Completed);
        var survivor = Assert.Single(await h.Store.GetFoldersAsync());
        Assert.Equal("f2", survivor.Id);
        Assert.Null(survivor.ParentId);
    }

    [Fact]
    public async Task A_folder_entry_is_never_mistaken_for_a_map_entry()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        await SaveAsync(h, Doc("m2", "Elsewhere", 1));
        await h.Store.SetFolderAsync("m1", "f1");
        await h.Store.CaptureFolderAsync("f1", "folderEntry");
        await h.Store.CaptureMapAsync("m2", "mapEntry");

        Assert.Equal(["mapEntry"], await h.Store.HeldMapEntryIdsAsync());
        Assert.Equal(["folderEntry"], await h.Store.HeldFolderEntryIdsAsync());
        Assert.True(await h.Store.MapHoldsAsync("mapEntry"));
        Assert.False(await h.Store.MapHoldsAsync("folderEntry"));
        Assert.True(await h.Store.FolderHoldsAsync("folderEntry"));
        Assert.False(await h.Store.FolderHoldsAsync("mapEntry"));
    }

    [Fact]
    public async Task Releasing_an_entry_returns_its_rows_without_reading_as_a_restore()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveFolderAsync(new MindmapFolder("f1", "Geology", null, 0));
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        await h.Store.SetFolderAsync("m1", "f1");
        await SaveAsync(h, Doc("m2", "Elsewhere", 1));
        await h.Store.CaptureFolderAsync("f1", "folderEntry");
        await h.Store.CaptureMapAsync("m2", "mapEntry");

        await h.Store.ReleaseMapsAsync(["mapEntry"]);
        await h.Store.ReleaseFoldersAsync(["folderEntry"]);

        Assert.Equal(2, (await h.Store.ListAsync()).Count);
        Assert.Single(await h.Store.GetFoldersAsync());
        Assert.Empty(await h.Store.HeldMapEntryIdsAsync());
        Assert.Empty(await h.Store.HeldFolderEntryIdsAsync());
    }

    [Fact]
    public async Task A_database_written_before_the_trash_existed_still_opens()
    {
        var dbPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"mnemo_mm_v3_{Guid.NewGuid():N}.db");
        try
        {
            await WriteVersionThreeDatabaseAsync(dbPath);

            await using var store = new MindmapStore(new Widgets.TestLogger(), dbPath);
            await store.InitializeAsync();

            var loaded = await store.LoadAsync("m1");
            Assert.Equal("Rock cycle", loaded!.Title);
            Assert.Equal("Geology", Assert.Single(await store.GetFoldersAsync()).Name);

            // The column the migration adds is what everything else in this file depends on.
            Assert.NotNull(await store.CaptureMapAsync("m1", "e1"));
            Assert.Null(await store.LoadAsync("m1"));
        }
        finally
        {
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                try { System.IO.File.Delete(dbPath + suffix); }
                catch { /* best effort */ }
            }
        }
    }

    /// <summary>
    /// Builds the schema as it stood before the trash, so the migration is exercised against rows a
    /// released build would have written rather than rows this one writes and then reads back.
    /// </summary>
    private static async Task WriteVersionThreeDatabaseAsync(string dbPath)
    {
        await using var connection = new SqliteConnection($"Data Source={dbPath}");
        await connection.OpenAsync();
        await ExecuteAsync(connection, """
            CREATE TABLE MindmapSchemaVersion (
                Version   INTEGER PRIMARY KEY,
                AppliedAt TEXT NOT NULL
            );
            CREATE TABLE Mindmaps (
                Id              TEXT PRIMARY KEY,
                Title           TEXT NOT NULL,
                SchemaVersion   INTEGER NOT NULL,
                Revision        INTEGER NOT NULL,
                Doc             TEXT NOT NULL,
                CreatedAt       TEXT NOT NULL,
                ModifiedAt      TEXT NOT NULL,
                FolderId        TEXT NULL,
                LinkedDecksJson TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE MindmapFolders (
                Id        TEXT PRIMARY KEY,
                ParentId  TEXT NULL REFERENCES MindmapFolders(Id) ON DELETE CASCADE,
                Name      TEXT NOT NULL,
                SortOrder INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE MindmapStyleTemplates (
                Id        TEXT PRIMARY KEY,
                Name      TEXT NOT NULL,
                Json      TEXT NOT NULL,
                CreatedAt TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE MindmapSearch USING fts5(MapId UNINDEXED, ElementId UNINDEXED, Text);
            INSERT INTO MindmapSchemaVersion (Version, AppliedAt) VALUES (3, '2026-01-01T00:00:00.0000000Z');
            INSERT INTO MindmapFolders (Id, ParentId, Name, SortOrder) VALUES ('f1', NULL, 'Geology', 0);
            """);

        var document = Doc("m1", "Rock cycle", 1);
        await using var insert = connection.CreateCommand();
        insert.CommandText = """
            INSERT INTO Mindmaps (Id, Title, SchemaVersion, Revision, Doc, CreatedAt, ModifiedAt, FolderId)
            VALUES ('m1', 'Rock cycle', 2, 1, $doc, '2026-01-01T00:00:00.0000000Z', '2026-01-01T00:00:00.0000000Z', 'f1');
            """;
        insert.Parameters.AddWithValue("$doc", MindmapDocumentSerializer.Serialize(document));
        await insert.ExecuteNonQueryAsync();
    }

    private static async Task ExecuteAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>The files a purge asked the cleanup worker to remove, in insertion order.</summary>
    private static async Task<IReadOnlyList<string>> QueuedFilesAsync(MindmapTestHarness h)
    {
        await using var connection = new SqliteConnection($"Data Source={h.DatabasePath}");
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Path FROM AssetCleanupJobs WHERE Owner = $owner ORDER BY Path;";
        command.Parameters.AddWithValue("$owner", MindmapAssetReferences.AssetOwner);

        var paths = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            paths.Add(reader.GetString(0));
        return paths;
    }

    private static Task SaveAsync(MindmapTestHarness h, MindmapDocument document) =>
        h.Store.SaveAsync(document, FullDelta(document));

    private static MindmapDocument Doc(string id, string title, long revision, params MindmapElement[] elements) =>
        new()
        {
            Id = id,
            Title = title,
            Revision = revision,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow,
            Elements = elements,
        };

    private static MindmapElement Node(string id, string text) =>
        new() { Id = id, Kind = ElementKind.Node, Content = new TextContent { Text = text } };

    private static MindmapElement Image(string id, string assetId) =>
        new() { Id = id, Kind = ElementKind.Image, Content = new CanvasImageContent { AssetId = assetId } };

    private static MindmapSearchDelta FullDelta(MindmapDocument document) =>
        new()
        {
            FullReplace = true,
            Upserts = document.Elements
                .Where(e => e.Content is TextContent)
                .Select(e => new MindmapSearchEntry(e.Id, ((TextContent)e.Content).Text))
                .ToList(),
        };
}
