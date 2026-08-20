using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;
using Xunit.Abstractions;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Proves the live-row indexes actually change the query plan <see cref="DeckRepository.ListHeadersAsync"/>
/// and <see cref="FolderRepository.ListAsync"/> run, and that dropping the index back out changes
/// nothing about what the two queries return.
/// </summary>
/// <remarks>
/// The schema always creates both indexes on a fresh database (<see cref="FlashcardStoreSchema.CreateIndexesOverAddedColumnsSql"/>),
/// so the "before" state here is made by dropping them back out of a real, seeded database rather
/// than by reverting the schema, and both the indexed and un-indexed plan are captured from that
/// same physical file in the same test run. The query text below is copied from the repositories
/// verbatim; if either query changes shape, this file's copy needs to change with it.
/// </remarks>
public sealed class FlashcardLiveIndexPlanTests
{
    private const string DeckQuery =
        "SELECT Id, FolderId, PresetId, Name, Description, TagsJson, SortOrder, LastStudied, Icon, CreatedAt, UpdatedAt " +
        "FROM FlashcardDecks WHERE TrashId IS NULL ORDER BY SortOrder, Name;";

    private const string FolderQuery =
        "SELECT Id, ParentId, Name, SortOrder FROM FlashcardFolders WHERE TrashId IS NULL ORDER BY SortOrder, Name;";

    private readonly ITestOutputHelper _output;

    public FlashcardLiveIndexPlanTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task Live_deck_and_folder_listings_use_the_index_and_return_the_same_rows_with_or_without_it()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_plan_{Guid.NewGuid():N}.db");
        try
        {
            await SeedAsync(path);

            // Present: the schema creates both indexes on a fresh database.
            var afterDeckPlan = await CapturePlanAsync(path, DeckQuery);
            var afterFolderPlan = await CapturePlanAsync(path, FolderQuery);
            var afterDeckRows = await CaptureDeckRowsAsync(path);
            var afterFolderRows = await CaptureFolderRowsAsync(path);

            await DropIndexesAsync(path);

            // Absent: the same file, the same rows, with only the two indexes physically gone.
            var beforeDeckPlan = await CapturePlanAsync(path, DeckQuery);
            var beforeFolderPlan = await CapturePlanAsync(path, FolderQuery);
            var beforeDeckRows = await CaptureDeckRowsAsync(path);
            var beforeFolderRows = await CaptureFolderRowsAsync(path);

            Report("FlashcardDecks: DeckRepository.ListHeadersAsync", "IX_Decks_Live", beforeDeckPlan, afterDeckPlan);
            Report("FlashcardFolders: FolderRepository.ListAsync", "IX_Folders_Live", beforeFolderPlan, afterFolderPlan);

            var beforeDeckText = string.Join(" | ", beforeDeckPlan);
            var afterDeckText = string.Join(" | ", afterDeckPlan);
            Assert.Contains("SCAN", beforeDeckText);
            Assert.Contains("TEMP B-TREE", beforeDeckText);
            Assert.Contains("IX_Decks_Live", afterDeckText);
            Assert.DoesNotContain("TEMP B-TREE", afterDeckText);

            var beforeFolderText = string.Join(" | ", beforeFolderPlan);
            var afterFolderText = string.Join(" | ", afterFolderPlan);
            Assert.Contains("SCAN", beforeFolderText);
            Assert.Contains("TEMP B-TREE", beforeFolderText);
            Assert.Contains("IX_Folders_Live", afterFolderText);
            Assert.DoesNotContain("TEMP B-TREE", afterFolderText);

            // An index that changes results is a bug: same rows, same order, with or without it.
            Assert.Equal(beforeDeckRows, afterDeckRows);
            Assert.Equal(beforeFolderRows, afterFolderRows);
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

    private void Report(string label, string indexName, IReadOnlyList<string> before, IReadOnlyList<string> after)
    {
        _output.WriteLine($"=== {label} ===");
        _output.WriteLine($"before (no {indexName}):");
        foreach (var line in before)
            _output.WriteLine("  " + line);
        _output.WriteLine($"after ({indexName} present):");
        foreach (var line in after)
            _output.WriteLine("  " + line);
    }

    /// <summary>A live deck and folder each, plus one of each in the trash, so the filter has something
    /// real to exclude and the SortOrder tie between the two live decks proves the ORDER BY.</summary>
    private static async Task SeedAsync(string path)
    {
        var now = DateTimeOffset.UtcNow;
        await using var store = new FlashcardStore(new TestLogger(), path);
        await store.InitializeAsync();
        await store.WriteAsync(async (conn, tx, ct) =>
        {
            await new PresetRepository().UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now), ct);

            var decks = new DeckRepository();
            await decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                "deck-b", null, FlashcardPreset.StandardPresetId, "Biology", null, Array.Empty<string>(), 1, null, null, now, now), ct);
            await decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                "deck-a", null, FlashcardPreset.StandardPresetId, "Anatomy", null, Array.Empty<string>(), 0, null, null, now, now), ct);
            await decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                "deck-c", null, FlashcardPreset.StandardPresetId, "Chemistry", null, Array.Empty<string>(), 1, null, null, now, now), ct);

            var folders = new FolderRepository();
            await folders.UpsertAsync(conn, tx, new FlashcardFolder("folder-b", "Biology", null, 1), now, ct);
            await folders.UpsertAsync(conn, tx, new FlashcardFolder("folder-a", "Anatomy", null, 0), now, ct);
            await folders.UpsertAsync(conn, tx, new FlashcardFolder("folder-c", "Chemistry", null, 1), now, ct);

            await using var trashDeck = conn.CreateCommand();
            trashDeck.Transaction = tx;
            trashDeck.CommandText = "UPDATE FlashcardDecks SET TrashId = 'trash-1' WHERE Id = 'deck-c';";
            await trashDeck.ExecuteNonQueryAsync(ct);

            await using var trashFolder = conn.CreateCommand();
            trashFolder.Transaction = tx;
            trashFolder.CommandText = "UPDATE FlashcardFolders SET TrashId = 'trash-1' WHERE Id = 'folder-c';";
            await trashFolder.ExecuteNonQueryAsync(ct);
        });
    }

    private static async Task<IReadOnlyList<string>> CapturePlanAsync(string path, string query)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "EXPLAIN QUERY PLAN " + query;

        var lines = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            lines.Add(reader.GetString(3));
        return lines;
    }

    private static async Task<IReadOnlyList<FlashcardDeckHeader>> CaptureDeckRowsAsync(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        return await new DeckRepository().ListHeadersAsync(conn, CancellationToken.None);
    }

    private static async Task<IReadOnlyList<FlashcardFolder>> CaptureFolderRowsAsync(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        return await new FolderRepository().ListAsync(conn, CancellationToken.None);
    }

    private static async Task DropIndexesAsync(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DROP INDEX IF EXISTS IX_Decks_Live; DROP INDEX IF EXISTS IX_Folders_Live;";
        await cmd.ExecuteNonQueryAsync();
    }
}
