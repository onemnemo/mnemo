using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Identity;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// The mindmap store's corpus-unique short id: minted on first save, carried through the list and
/// library reads, resolvable by either address, and backfilled into a database written before it
/// existed.
/// </summary>
public sealed class MindmapSidTests
{
    [Fact]
    public async Task First_save_mints_a_well_formed_sid()
    {
        await using var h = new MindmapTestHarness();

        await SaveAsync(h, Doc("m1", "Rock cycle", 1));

        var summary = Assert.Single(await h.Store.ListAsync());
        Assert.True(Sid.IsWellFormedMindmapSid(summary.Sid), $"'{summary.Sid}' is not a well-formed mindmap sid.");
    }

    [Fact]
    public async Task Saving_the_same_document_again_keeps_its_sid()
    {
        await using var h = new MindmapTestHarness();
        var document = Doc("m1", "Rock cycle", 1);
        await SaveAsync(h, document);
        var firstSid = Assert.Single(await h.Store.ListAsync()).Sid;

        await SaveAsync(h, document with { Title = "Rock cycle (edited)", Revision = 2 });

        var secondSid = Assert.Single(await h.Store.ListAsync()).Sid;
        Assert.Equal(firstSid, secondSid);
    }

    [Fact]
    public async Task Two_maps_get_different_sids()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "One", 1));
        await SaveAsync(h, Doc("m2", "Two", 1));

        var sids = (await h.Store.ListAsync()).Select(s => s.Sid).ToList();
        Assert.Equal(2, sids.Distinct().Count());
    }

    [Fact]
    public async Task ResolveAsync_finds_a_map_by_sid_and_by_id()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        var sid = Assert.Single(await h.Store.ListAsync()).Sid;

        var bySid = await h.Store.ResolveAsync(sid);
        var byId = await h.Store.ResolveAsync("m1");

        Assert.NotNull(bySid);
        Assert.Equal("m1", bySid!.Id);
        Assert.Equal(sid, bySid.Sid);
        Assert.NotNull(byId);
        Assert.Equal("m1", byId!.Id);
        Assert.Equal(sid, byId.Sid);
    }

    [Fact]
    public async Task ResolveAsync_returns_null_for_a_trashed_map()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        var sid = Assert.Single(await h.Store.ListAsync()).Sid;

        await h.Store.CaptureMapAsync("m1", "e1");

        Assert.Null(await h.Store.ResolveAsync(sid));
        Assert.Null(await h.Store.ResolveAsync("m1"));
    }

    [Fact]
    public async Task A_map_restored_from_the_trash_keeps_its_sid()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));
        var sid = Assert.Single(await h.Store.ListAsync()).Sid;
        await h.Store.CaptureMapAsync("m1", "e1");

        await h.Store.RestoreMapAsync("e1");

        var restored = Assert.Single(await h.Store.ListAsync());
        Assert.Equal(sid, restored.Sid);
    }

    [Fact]
    public async Task ListAsync_and_GetLibraryAsync_carry_the_sid()
    {
        await using var h = new MindmapTestHarness();
        await SaveAsync(h, Doc("m1", "Rock cycle", 1));

        var summary = Assert.Single(await h.Store.ListAsync());
        var entry = Assert.Single(await h.Store.GetLibraryAsync());

        Assert.False(string.IsNullOrEmpty(summary.Sid));
        Assert.Equal(summary.Sid, entry.Sid);
    }

    // ---------------------------------------------------------------- upgrade

    [Fact]
    public async Task A_database_written_before_sids_existed_gets_one_per_row_on_open()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_mm_v5_{Guid.NewGuid():N}.db");
        try
        {
            await WriteVersionFiveDatabaseAsync(dbPath);
            var beforeM1 = await ReadRowAsync(dbPath, "m1");
            var beforeM2 = await ReadRowAsync(dbPath, "m2");

            await using (var store = new MindmapStore(new TestLogger(), dbPath))
                await store.InitializeAsync();

            SqliteTestPools.ClearPoolFor(dbPath);
            Assert.True(await ColumnExistsAsync(dbPath, "Mindmaps", "Sid"));
            Assert.True(await IndexExistsAsync(dbPath, "IX_Mindmaps_Sid"));

            await using var reopened = new MindmapStore(new TestLogger(), dbPath);
            await reopened.InitializeAsync();
            var summaries = await reopened.ListAsync();

            Assert.Equal(2, summaries.Count);
            foreach (var summary in summaries)
                Assert.True(Sid.IsWellFormedMindmapSid(summary.Sid), $"'{summary.Sid}' is not a well-formed mindmap sid.");
            Assert.Equal(summaries.Count, summaries.Select(s => s.Sid).Distinct().Count());

            // The backfill only ever assigns Sid: everything else about each row, Doc and ModifiedAt
            // included, survives the upgrade byte for byte.
            var afterM1 = await ReadRowAsync(dbPath, "m1");
            var afterM2 = await ReadRowAsync(dbPath, "m2");
            Assert.Equal(beforeM1, afterM1);
            Assert.Equal(beforeM2, afterM2);
        }
        finally
        {
            SqliteTestPools.ClearPoolFor(dbPath);
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                try { File.Delete(dbPath + suffix); }
                catch { /* best effort */ }
            }
        }
    }

    /// <summary>
    /// Builds the schema as it stood at version 5 (every column and index up through the folder
    /// live index, no Sid column yet), so the migration runs against rows a released build would
    /// have written rather than rows this test writes and reads back.
    /// </summary>
    private static async Task WriteVersionFiveDatabaseAsync(string dbPath)
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
                LinkedDecksJson TEXT NOT NULL DEFAULT '[]',
                TrashId         TEXT NULL
            );
            CREATE TABLE MindmapFolders (
                Id        TEXT PRIMARY KEY,
                ParentId  TEXT NULL REFERENCES MindmapFolders(Id) ON DELETE CASCADE,
                Name      TEXT NOT NULL,
                SortOrder INTEGER NOT NULL DEFAULT 0,
                TrashId   TEXT NULL
            );
            CREATE TABLE MindmapStyleTemplates (
                Id        TEXT PRIMARY KEY,
                Name      TEXT NOT NULL,
                Json      TEXT NOT NULL,
                CreatedAt TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE MindmapSearch USING fts5(MapId UNINDEXED, ElementId UNINDEXED, Text);
            CREATE INDEX IX_Mindmaps_Live ON Mindmaps(TrashId, ModifiedAt DESC);
            CREATE INDEX IX_Mindmaps_Trash ON Mindmaps(TrashId) WHERE TrashId IS NOT NULL;
            CREATE INDEX IX_MindmapFolders_Trash ON MindmapFolders(TrashId) WHERE TrashId IS NOT NULL;
            CREATE INDEX IX_MindmapFolders_Live ON MindmapFolders(TrashId, SortOrder);
            INSERT INTO MindmapSchemaVersion (Version, AppliedAt) VALUES (5, '2026-01-01T00:00:00.0000000Z');
            """);

        foreach (var (id, title) in new (string, string)[] { ("m1", "Rock cycle"), ("m2", "Water cycle") })
        {
            await using var insert = connection.CreateCommand();
            insert.CommandText = """
                INSERT INTO Mindmaps (Id, Title, SchemaVersion, Revision, Doc, CreatedAt, ModifiedAt)
                VALUES ($id, $title, 2, 1, $doc, '2026-01-01T00:00:00.0000000Z', '2026-01-01T00:00:00.0000000Z');
                """;
            insert.Parameters.AddWithValue("$id", id);
            insert.Parameters.AddWithValue("$title", title);
            insert.Parameters.AddWithValue("$doc", MindmapDocumentSerializer.Serialize(Doc(id, title, 1)));
            await insert.ExecuteNonQueryAsync();
        }
    }

    private static async Task<(string Doc, string ModifiedAt)> ReadRowAsync(string dbPath, string id)
    {
        SqliteTestPools.ClearPoolFor(dbPath);
        await using var connection = new SqliteConnection($"Data Source={dbPath}");
        await connection.OpenAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Doc, ModifiedAt FROM Mindmaps WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$id", id);
        await using var reader = await cmd.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return (reader.GetString(0), reader.GetString(1));
    }

    private static async Task<bool> ColumnExistsAsync(string dbPath, string table, string column)
    {
        SqliteTestPools.ClearPoolFor(dbPath);
        await using var connection = new SqliteConnection($"Data Source={dbPath}");
        await connection.OpenAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table});";
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static async Task<bool> IndexExistsAsync(string dbPath, string index)
    {
        SqliteTestPools.ClearPoolFor(dbPath);
        await using var connection = new SqliteConnection($"Data Source={dbPath}");
        await connection.OpenAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = $name LIMIT 1;";
        cmd.Parameters.AddWithValue("$name", index);
        return await cmd.ExecuteScalarAsync() is not null;
    }

    private static async Task ExecuteAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
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
