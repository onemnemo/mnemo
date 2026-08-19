using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Infrastructure.Services.Mindmap.Persistence;

/// <summary>
/// The trash half of the mindmap store: the writes that take a map or a folder out of the library
/// without destroying it, put it back, or finish the job.
/// </summary>
/// <remarks>
/// <para>
/// Held rows keep everything: revision, timestamps, folder membership, linked decks, and their search
/// index rows. Restoring is one column going back to null, so a recovered map is the same map, not a
/// re-imported copy.
/// </para>
/// <para>
/// A folder entry marks its own row and everything live beneath it, maps included, with the same
/// entry id. That makes a map row's mark ambiguous on its own, so the map half tells the two apart by
/// asking whether any folder row carries the same id: a folder capture always marks at least one
/// folder, an ordinary map capture never does.
/// </para>
/// </remarks>
public sealed partial class MindmapStore : IMindmapTrashStore
{
    /// <summary>How many ids one parameterized IN list carries, matching the search delta chunking.</summary>
    private const int TrashChunkSize = 400;

    public Task<TrashSnapshot?> PrepareMapAsync(string mapId, CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = """
                SELECT m.Title, f.Name FROM Mindmaps m
                LEFT JOIN MindmapFolders f ON f.Id = m.FolderId AND f.TrashId IS NULL
                WHERE m.Id = $id AND m.TrashId IS NULL;
                """;
            cmd.Parameters.AddWithValue("$id", mapId);
            return await ReadMapSnapshotAsync(cmd, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task<TrashSnapshot?> CaptureMapAsync(string mapId, string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            TrashSnapshot? snapshot;
            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                // Reading the entry's own mark as well as a live row is what makes a second capture of
                // the same entry report the same thing rather than find nothing.
                read.CommandText = """
                    SELECT m.Title, f.Name FROM Mindmaps m
                    LEFT JOIN MindmapFolders f ON f.Id = m.FolderId AND f.TrashId IS NULL
                    WHERE m.Id = $id AND (m.TrashId IS NULL OR m.TrashId = $entry);
                    """;
                read.Parameters.AddWithValue("$id", mapId);
                read.Parameters.AddWithValue("$entry", entryId);
                snapshot = await ReadMapSnapshotAsync(read, cancellationToken).ConfigureAwait(false);
            }

            if (snapshot is null)
                return null;

            await using var mark = writer.CreateCommand();
            mark.Transaction = tx;
            mark.CommandText = "UPDATE Mindmaps SET TrashId = $entry WHERE Id = $id AND TrashId IS NULL;";
            mark.Parameters.AddWithValue("$id", mapId);
            mark.Parameters.AddWithValue("$entry", entryId);
            await mark.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);

            return snapshot;
        }, cancellationToken);

    public Task<TrashRestore> RestoreMapAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            string? folderId;
            string? liveFolderId;
            string? liveFolderName;
            bool folderHeld;

            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = """
                    SELECT m.FolderId, live.Id, live.Name, held.Id FROM Mindmaps m
                    LEFT JOIN MindmapFolders live ON live.Id = m.FolderId AND live.TrashId IS NULL
                    LEFT JOIN MindmapFolders held ON held.Id = m.FolderId AND held.TrashId IS NOT NULL
                    WHERE m.TrashId = $entry
                    LIMIT 1;
                    """;
                read.Parameters.AddWithValue("$entry", entryId);

                await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
                if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                    return new TrashRestore(TrashRestoreOutcome.Missing);

                folderId = reader.IsDBNull(0) ? null : reader.GetString(0);
                liveFolderId = reader.IsDBNull(1) ? null : reader.GetString(1);
                liveFolderName = reader.IsDBNull(2) ? null : reader.GetString(2);
                folderHeld = !reader.IsDBNull(3);
            }

            // The folder is in the trash too. Rooting the map here would quietly undo the arrangement
            // the user is about to recover, so the map stays put and the caller is told to restore the
            // folder first.
            if (folderHeld)
                return new TrashRestore(TrashRestoreOutcome.BlockedByContainer);

            // The folder the map came from was deleted while the map sat in the trash. Rooting it is
            // the honest outcome: the map comes back, and the caller can say where it landed.
            var rooted = folderId is not null && liveFolderId is null;

            await using var clear = writer.CreateCommand();
            clear.Transaction = tx;
            clear.CommandText = rooted
                ? "UPDATE Mindmaps SET TrashId = NULL, FolderId = NULL WHERE TrashId = $entry;"
                : "UPDATE Mindmaps SET TrashId = NULL WHERE TrashId = $entry;";
            clear.Parameters.AddWithValue("$entry", entryId);
            await clear.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);

            return rooted
                ? new TrashRestore(TrashRestoreOutcome.Rooted)
                : new TrashRestore(TrashRestoreOutcome.Restored, liveFolderId, liveFolderName);
        }, cancellationToken);

    public Task PurgeMapAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await DestroyHeldMapsAsync(writer, tx, entryId, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task<bool> MapHoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = """
                SELECT 1 FROM Mindmaps
                WHERE TrashId = $entry
                  AND NOT EXISTS (SELECT 1 FROM MindmapFolders WHERE TrashId = $entry)
                LIMIT 1;
                """;
            cmd.Parameters.AddWithValue("$entry", entryId);
            return await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
        }, cancellationToken);

    public Task<IReadOnlyCollection<string>> HeldMapEntryIdsAsync(CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = """
                SELECT DISTINCT m.TrashId FROM Mindmaps m
                WHERE m.TrashId IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM MindmapFolders f WHERE f.TrashId = m.TrashId);
                """;
            return (IReadOnlyCollection<string>)await ReadStringsAsync(cmd, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task ReleaseMapsAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await ClearMarksAsync(writer, tx, "Mindmaps", entryIds, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task<TrashSnapshot?> PrepareFolderAsync(string folderId, CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            string name;
            string? origin;

            await using (var read = connection.CreateCommand())
            {
                read.CommandText = """
                    SELECT f.Name, p.Name FROM MindmapFolders f
                    LEFT JOIN MindmapFolders p ON p.Id = f.ParentId AND p.TrashId IS NULL
                    WHERE f.Id = $id AND f.TrashId IS NULL;
                    """;
                read.Parameters.AddWithValue("$id", folderId);

                await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
                if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                    return null;

                name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
                origin = reader.IsDBNull(1) ? null : reader.GetString(1);
            }

            await using var count = connection.CreateCommand();
            count.CommandText = $"""
                {LiveSubtreeSql}
                SELECT COUNT(*) FROM Mindmaps WHERE TrashId IS NULL AND FolderId IN (SELECT Id FROM Subtree);
                """;
            count.Parameters.AddWithValue("$id", folderId);
            var contained = Convert.ToInt32(await count.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) ?? 0);

            return new TrashSnapshot(name, origin, contained);
        }, cancellationToken);

    public Task<TrashSnapshot?> CaptureFolderAsync(string folderId, string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            string name;
            string? origin;

            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                read.CommandText = """
                    SELECT f.Name, p.Name FROM MindmapFolders f
                    LEFT JOIN MindmapFolders p ON p.Id = f.ParentId AND p.TrashId IS NULL
                    WHERE f.Id = $id AND (f.TrashId IS NULL OR f.TrashId = $entry);
                    """;
                read.Parameters.AddWithValue("$id", folderId);
                read.Parameters.AddWithValue("$entry", entryId);

                await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
                if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                    return null;

                name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
                origin = reader.IsDBNull(1) ? null : reader.GetString(1);
            }

            // The walk stops at a folder another entry already holds, so one delete never takes rows
            // out from under another. Its own marks are walked through, which is what lets a repeated
            // capture finish a run that was interrupted halfway.
            List<string> subtree;
            await using (var walk = writer.CreateCommand())
            {
                walk.Transaction = tx;
                walk.CommandText = $"""
                    {EntrySubtreeSql}
                    SELECT Id FROM Subtree;
                    """;
                walk.Parameters.AddWithValue("$id", folderId);
                walk.Parameters.AddWithValue("$entry", entryId);
                subtree = await ReadStringsAsync(walk, cancellationToken).ConfigureAwait(false);
            }

            await MarkFoldersAsync(writer, tx, subtree, entryId, cancellationToken).ConfigureAwait(false);

            await using (var markMaps = writer.CreateCommand())
            {
                markMaps.Transaction = tx;
                markMaps.CommandText = """
                    UPDATE Mindmaps SET TrashId = $entry
                    WHERE TrashId IS NULL
                      AND FolderId IN (SELECT Id FROM MindmapFolders WHERE TrashId = $entry);
                    """;
                markMaps.Parameters.AddWithValue("$entry", entryId);
                await markMaps.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await using var count = writer.CreateCommand();
            count.Transaction = tx;
            count.CommandText = "SELECT COUNT(*) FROM Mindmaps WHERE TrashId = $entry;";
            count.Parameters.AddWithValue("$entry", entryId);
            var contained = Convert.ToInt32(await count.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) ?? 0);

            return new TrashSnapshot(name, origin, contained);
        }, cancellationToken);

    public Task<TrashRestore> RestoreFolderAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            string rootId;
            string? parentId;
            string? liveParentId;
            string? liveParentName;
            bool parentHeld;

            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                // The entry's root folder is the one whose parent this entry does not also hold.
                read.CommandText = """
                    SELECT f.Id, f.ParentId, live.Id, live.Name, held.Id FROM MindmapFolders f
                    LEFT JOIN MindmapFolders live ON live.Id = f.ParentId AND live.TrashId IS NULL
                    LEFT JOIN MindmapFolders held ON held.Id = f.ParentId AND held.TrashId IS NOT NULL
                    WHERE f.TrashId = $entry
                      AND (f.ParentId IS NULL
                           OR f.ParentId NOT IN (SELECT Id FROM MindmapFolders WHERE TrashId = $entry))
                    LIMIT 1;
                    """;
                read.Parameters.AddWithValue("$entry", entryId);

                await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
                if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                    return new TrashRestore(TrashRestoreOutcome.Missing);

                rootId = reader.GetString(0);
                parentId = reader.IsDBNull(1) ? null : reader.GetString(1);
                liveParentId = reader.IsDBNull(2) ? null : reader.GetString(2);
                liveParentName = reader.IsDBNull(3) ? null : reader.GetString(3);
                parentHeld = !reader.IsDBNull(4);
            }

            // The folder this one sat in is in the trash as well, so it comes back once that does.
            if (parentHeld)
                return new TrashRestore(TrashRestoreOutcome.BlockedByContainer);

            var rooted = parentId is not null && liveParentId is null;
            if (rooted)
            {
                await using var reparent = writer.CreateCommand();
                reparent.Transaction = tx;
                reparent.CommandText = "UPDATE MindmapFolders SET ParentId = NULL WHERE Id = $id;";
                reparent.Parameters.AddWithValue("$id", rootId);
                await reparent.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await using (var folders = writer.CreateCommand())
            {
                folders.Transaction = tx;
                folders.CommandText = "UPDATE MindmapFolders SET TrashId = NULL WHERE TrashId = $entry;";
                folders.Parameters.AddWithValue("$entry", entryId);
                await folders.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await using (var maps = writer.CreateCommand())
            {
                maps.Transaction = tx;
                maps.CommandText = "UPDATE Mindmaps SET TrashId = NULL WHERE TrashId = $entry;";
                maps.Parameters.AddWithValue("$entry", entryId);
                await maps.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            return rooted
                ? new TrashRestore(TrashRestoreOutcome.Rooted)
                : new TrashRestore(TrashRestoreOutcome.Restored, liveParentId, liveParentName);
        }, cancellationToken);

    public Task<TrashPurge> PurgeFolderAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            List<string> blocking;
            await using (var read = writer.CreateCommand())
            {
                read.Transaction = tx;
                // Deleting a folder cascades to its children. A child another entry holds would be
                // destroyed with it, so that entry has to be dealt with first.
                read.CommandText = """
                    SELECT DISTINCT child.TrashId FROM MindmapFolders child
                    WHERE child.ParentId IN (SELECT Id FROM MindmapFolders WHERE TrashId = $entry)
                      AND child.TrashId IS NOT NULL
                      AND child.TrashId <> $entry;
                    """;
                read.Parameters.AddWithValue("$entry", entryId);
                blocking = await ReadStringsAsync(read, cancellationToken).ConfigureAwait(false);
            }

            if (blocking.Count > 0)
                return TrashPurge.Blocked(blocking);

            // A live child under a held folder is not something the library can produce, but the
            // cascade would destroy one if it existed. Lifting it to the root keeps the rule that
            // permanent deletion only ever destroys what the entry itself holds.
            await using (var lift = writer.CreateCommand())
            {
                lift.Transaction = tx;
                lift.CommandText = """
                    UPDATE MindmapFolders SET ParentId = NULL
                    WHERE TrashId IS NULL
                      AND ParentId IN (SELECT Id FROM MindmapFolders WHERE TrashId = $entry);
                    """;
                lift.Parameters.AddWithValue("$entry", entryId);
                await lift.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await DestroyHeldMapsAsync(writer, tx, entryId, cancellationToken).ConfigureAwait(false);

            await using var folders = writer.CreateCommand();
            folders.Transaction = tx;
            folders.CommandText = "DELETE FROM MindmapFolders WHERE TrashId = $entry;";
            folders.Parameters.AddWithValue("$entry", entryId);
            await folders.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);

            return TrashPurge.Done();
        }, cancellationToken);

    public Task<bool> FolderHoldsAsync(string entryId, CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT 1 FROM MindmapFolders WHERE TrashId = $entry LIMIT 1;";
            cmd.Parameters.AddWithValue("$entry", entryId);
            return await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
        }, cancellationToken);

    public Task<IReadOnlyCollection<string>> HeldFolderEntryIdsAsync(CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT DISTINCT TrashId FROM MindmapFolders WHERE TrashId IS NOT NULL;";
            return (IReadOnlyCollection<string>)await ReadStringsAsync(cmd, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task ReleaseFoldersAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        WriteAsync(async (writer, tx) =>
        {
            await ClearMarksAsync(writer, tx, "MindmapFolders", entryIds, cancellationToken).ConfigureAwait(false);
            await ClearMarksAsync(writer, tx, "Mindmaps", entryIds, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task<IReadOnlyList<string>> ListAllOwnedIdsAsync(CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT Id FROM Mindmaps;";
            return (IReadOnlyList<string>)await ReadStringsAsync(cmd, cancellationToken).ConfigureAwait(false);
        }, cancellationToken);

    public Task<MindmapDocument?> LoadAllOwnedAsync(string id, CancellationToken cancellationToken = default) =>
        ReadAsync(async connection =>
        {
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT Doc FROM Mindmaps WHERE Id = $id;";
            cmd.Parameters.AddWithValue("$id", id);

            var json = (string?)await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
            return json is null ? null : MindmapDocumentSerializer.Deserialize(json);
        }, cancellationToken);

    /// <summary>Folders reachable from $id that nothing has taken yet.</summary>
    private const string LiveSubtreeSql = """
        WITH RECURSIVE Subtree(Id) AS (
            SELECT Id FROM MindmapFolders WHERE Id = $id AND TrashId IS NULL
            UNION ALL
            SELECT child.Id FROM MindmapFolders child
            JOIN Subtree s ON child.ParentId = s.Id
            WHERE child.TrashId IS NULL
        )
        """;

    /// <summary>The same walk, also stepping through rows this entry already holds.</summary>
    private const string EntrySubtreeSql = """
        WITH RECURSIVE Subtree(Id) AS (
            SELECT Id FROM MindmapFolders WHERE Id = $id AND (TrashId IS NULL OR TrashId = $entry)
            UNION ALL
            SELECT child.Id FROM MindmapFolders child
            JOIN Subtree s ON child.ParentId = s.Id
            WHERE child.TrashId IS NULL OR child.TrashId = $entry
        )
        """;

    /// <summary>
    /// Moves every held folder under <paramref name="folderId"/> to the root, so a delete of that
    /// folder cannot cascade into the trash.
    /// </summary>
    /// <remarks>
    /// An ordinary folder delete is a live operation and has no business destroying something the user
    /// already deleted and can still recover. Rooting is enough: a held folder is invisible either way,
    /// and its restore now reports the root rather than a parent that no longer exists.
    /// </remarks>
    private static async Task LiftHeldDescendantsAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string folderId,
        CancellationToken cancellationToken)
    {
        List<string> held;
        await using (var read = writer.CreateCommand())
        {
            read.Transaction = tx;
            // The walk steps through live and held rows alike, since a held folder can sit under a live
            // one that is itself about to go.
            read.CommandText = """
                WITH RECURSIVE Subtree(Id) AS (
                    SELECT Id FROM MindmapFolders WHERE ParentId = $id
                    UNION ALL
                    SELECT child.Id FROM MindmapFolders child
                    JOIN Subtree s ON child.ParentId = s.Id
                )
                SELECT s.Id FROM Subtree s
                JOIN MindmapFolders f ON f.Id = s.Id
                WHERE f.TrashId IS NOT NULL;
                """;
            read.Parameters.AddWithValue("$id", folderId);
            held = await ReadStringsAsync(read, cancellationToken).ConfigureAwait(false);
        }

        if (held.Count == 0)
            return;

        for (var offset = 0; offset < held.Count; offset += TrashChunkSize)
        {
            var chunk = held.GetRange(offset, Math.Min(TrashChunkSize, held.Count - offset));
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;

            var names = new List<string>(chunk.Count);
            for (var i = 0; i < chunk.Count; i++)
            {
                var name = $"$h{i}";
                names.Add(name);
                cmd.Parameters.AddWithValue(name, chunk[i]);
            }

            cmd.CommandText = $"UPDATE MindmapFolders SET ParentId = NULL WHERE Id IN ({string.Join(", ", names)});";
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Stamps the given folder rows that nothing else has taken.</summary>
    private static async Task MarkFoldersAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        List<string> folderIds,
        string entryId,
        CancellationToken cancellationToken)
    {
        for (var offset = 0; offset < folderIds.Count; offset += TrashChunkSize)
        {
            var chunk = folderIds.GetRange(offset, Math.Min(TrashChunkSize, folderIds.Count - offset));
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;

            var names = new List<string>(chunk.Count);
            for (var i = 0; i < chunk.Count; i++)
            {
                var name = $"$f{i}";
                names.Add(name);
                cmd.Parameters.AddWithValue(name, chunk[i]);
            }

            cmd.Parameters.AddWithValue("$entry", entryId);
            cmd.CommandText =
                $"UPDATE MindmapFolders SET TrashId = $entry WHERE TrashId IS NULL AND Id IN ({string.Join(", ", names)});";
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Destroys every map the entry holds, its search rows with it, and queues the files those maps
    /// were the reason to keep.
    /// </summary>
    private async Task DestroyHeldMapsAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string entryId,
        CancellationToken cancellationToken)
    {
        var mapIds = new List<string>();
        var assets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        await using (var read = writer.CreateCommand())
        {
            read.Transaction = tx;
            read.CommandText = "SELECT Id, Doc FROM Mindmaps WHERE TrashId = $entry;";
            read.Parameters.AddWithValue("$entry", entryId);

            await using var reader = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var mapId = reader.GetString(0);
                mapIds.Add(mapId);

                // A map whose document will not read still has to go. Its files stay, which costs
                // disk space; guessing at references from a document this cannot parse would cost
                // an image another map still shows.
                var document = TryReadStoredDocument(mapId, reader.IsDBNull(1) ? null : reader.GetString(1));
                if (document is not null)
                    MindmapAssetReferences.Collect(document, assets);
            }
        }

        if (mapIds.Count == 0)
            return;

        for (var offset = 0; offset < mapIds.Count; offset += TrashChunkSize)
        {
            var chunk = mapIds.GetRange(offset, Math.Min(TrashChunkSize, mapIds.Count - offset));
            await using var clear = writer.CreateCommand();
            clear.Transaction = tx;

            var names = new List<string>(chunk.Count);
            for (var i = 0; i < chunk.Count; i++)
            {
                var name = $"$m{i}";
                names.Add(name);
                clear.Parameters.AddWithValue(name, chunk[i]);
            }

            clear.CommandText = $"DELETE FROM MindmapSearch WHERE MapId IN ({string.Join(", ", names)});";
            await clear.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var delete = writer.CreateCommand())
        {
            delete.Transaction = tx;
            delete.CommandText = "DELETE FROM Mindmaps WHERE TrashId = $entry;";
            delete.Parameters.AddWithValue("$entry", entryId);
            await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await AssetCleanupQueue.EnqueueAsync(
            writer,
            tx,
            MindmapAssetReferences.AssetOwner,
            assets,
            DateTimeOffset.UtcNow,
            cancellationToken).ConfigureAwait(false);
    }

    private static async Task ClearMarksAsync(
        SqliteConnection writer,
        SqliteTransaction tx,
        string table,
        IReadOnlyCollection<string> entryIds,
        CancellationToken cancellationToken)
    {
        if (entryIds.Count == 0)
            return;

        var ids = new List<string>(entryIds);
        for (var offset = 0; offset < ids.Count; offset += TrashChunkSize)
        {
            var chunk = ids.GetRange(offset, Math.Min(TrashChunkSize, ids.Count - offset));
            await using var cmd = writer.CreateCommand();
            cmd.Transaction = tx;

            var names = new List<string>(chunk.Count);
            for (var i = 0; i < chunk.Count; i++)
            {
                var name = $"$e{i}";
                names.Add(name);
                cmd.Parameters.AddWithValue(name, chunk[i]);
            }

            cmd.CommandText = $"UPDATE {table} SET TrashId = NULL WHERE TrashId IN ({string.Join(", ", names)});";
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>The stored document, or null when it cannot be read, logged so the map is findable.</summary>
    private MindmapDocument? TryReadStoredDocument(string id, string? json)
    {
        if (json is null)
            return null;

        try
        {
            return MindmapDocumentSerializer.Deserialize(json);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or NotSupportedException)
        {
            _logger.Warning("Mindmap", $"Mindmap '{id}' could not be read, so the files it named were left in place: {ex.Message}");
            return null;
        }
    }

    private static async Task<TrashSnapshot?> ReadMapSnapshotAsync(SqliteCommand cmd, CancellationToken cancellationToken)
    {
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            return null;

        var title = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
        var origin = reader.IsDBNull(1) ? null : reader.GetString(1);
        return new TrashSnapshot(title, origin, 0);
    }

    private static async Task<List<string>> ReadStringsAsync(SqliteCommand cmd, CancellationToken cancellationToken)
    {
        var values = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            if (!reader.IsDBNull(0))
                values.Add(reader.GetString(0));
        }

        return values;
    }
}
