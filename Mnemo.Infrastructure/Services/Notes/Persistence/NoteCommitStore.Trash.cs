using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Trash;

namespace Mnemo.Infrastructure.Services.Notes.Persistence;

/// <summary>
/// The trash half of the note writer, plus the folder writes it had to take over to make the two
/// halves agree.
/// </summary>
/// <remarks>
/// <para>
/// A held note or folder is recorded in a map beside the library, keyed by the item and valued with
/// the trash entry holding it. Everything else about the row is left exactly as it was, so restoring
/// is one map entry going away and a recovered note is the same note rather than a re-imported copy.
/// </para>
/// <para>
/// A folder entry marks its own row, every folder beneath it, and every note filed in any of them,
/// all under the same entry id. That makes a note's mark ambiguous on its own, so the note half tells
/// the two apart by asking whether any folder carries the same id: a folder capture always marks at
/// least one folder, an ordinary note capture never does.
/// </para>
/// </remarks>
public sealed partial class NoteCommitStore : INoteTrashStore, INoteFolderStore
{
    /// <summary>The storage key of the folder id index. Owned here; readers must not restate it.</summary>
    public const string FolderIndexKey = "note_folders_index";

    /// <summary>The storage key of the map from held note to the entry holding it.</summary>
    public const string NoteTrashKey = "notes_trash";

    /// <summary>The storage key of the map from held folder to the entry holding it.</summary>
    public const string FolderTrashKey = "note_folders_trash";

    /// <summary>The storage key of one folder's row. Owned here; readers must not restate it.</summary>
    public static string FolderKey(string folderId) => $"note_folder_{folderId}";

    // ---- Folder writes ---------------------------------------------------------------------------

    public Task<bool> SaveFolderAsync(NoteFolder folder, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(folder);

        return WriteAsync(async (conn, tx, ct) =>
        {
            var held = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
            if (held.ContainsKey(folder.FolderId))
                return false;

            await WriteValueAsync(conn, tx, FolderKey(folder.FolderId), folder, ct).ConfigureAwait(false);

            var index = await ReadValueAsync<List<string>>(conn, tx, FolderIndexKey, ct).ConfigureAwait(false) ?? [];
            if (!index.Contains(folder.FolderId))
            {
                index.Add(folder.FolderId);
                await WriteValueAsync(conn, tx, FolderIndexKey, index, ct).ConfigureAwait(false);
            }

            return true;
        }, cancellationToken);
    }

    public Task<bool> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);

        return WriteAsync(async (conn, tx, ct) =>
        {
            var held = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
            if (held.ContainsKey(folderId))
                return false;

            await DestroyFolderRowAsync(conn, tx, folderId, ct).ConfigureAwait(false);
            return true;
        }, cancellationToken);
    }

    // ---- Notes -----------------------------------------------------------------------------------

    public Task<IReadOnlyDictionary<string, string>> HeldNoteIdsAsync(CancellationToken cancellationToken = default) =>
        ReadMapAsync(NoteTrashKey, cancellationToken);

    public Task<IReadOnlyDictionary<string, string>> HeldFolderIdsAsync(CancellationToken cancellationToken = default) =>
        ReadMapAsync(FolderTrashKey, cancellationToken);

    public Task<TrashSnapshot?> PrepareNoteAsync(string noteId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            var held = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);
            return held.ContainsKey(noteId)
                ? null
                : await NoteSnapshotAsync(conn, tx, noteId, ct).ConfigureAwait(false);
        }, cancellationToken);

    public Task<TrashSnapshot?> CaptureNoteAsync(string noteId, string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            var held = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);

            // A second capture of the same entry answers the same way rather than finding nothing,
            // which is what makes a retried delete land once.
            if (held.TryGetValue(noteId, out var owner) && owner != entryId)
                return null;

            var snapshot = await NoteSnapshotAsync(conn, tx, noteId, ct).ConfigureAwait(false);
            if (snapshot is null)
                return null;

            held[noteId] = entryId;
            await WriteValueAsync(conn, tx, NoteTrashKey, held, ct).ConfigureAwait(false);
            return snapshot;
        }, cancellationToken);

    public Task<TrashRestore> RestoreNoteAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            var held = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);
            var noteId = held.FirstOrDefault(pair => pair.Value == entryId).Key;
            if (noteId is null)
                return new TrashRestore(TrashRestoreOutcome.Missing);

            var note = await ReadValueAsync<Note>(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
            if (note is null)
            {
                // The row went away underneath the mark. Clearing it keeps the ledger from pointing at
                // something no restore could ever produce.
                held.Remove(noteId);
                await WriteValueAsync(conn, tx, NoteTrashKey, held, ct).ConfigureAwait(false);
                return new TrashRestore(TrashRestoreOutcome.Missing);
            }

            var placement = await ResolvePlacementAsync(conn, tx, note.FolderId, ct).ConfigureAwait(false);
            if (placement.Outcome == TrashRestoreOutcome.BlockedByContainer)
                return new TrashRestore(TrashRestoreOutcome.BlockedByContainer);

            if (placement.Outcome == TrashRestoreOutcome.Rooted)
            {
                note.FolderId = null;
                note.FolderPath = string.Empty;
                await WriteValueAsync(conn, tx, NoteKey(noteId), note, ct).ConfigureAwait(false);
            }

            held.Remove(noteId);
            await WriteValueAsync(conn, tx, NoteTrashKey, held, ct).ConfigureAwait(false);

            return placement.Outcome == TrashRestoreOutcome.Rooted
                ? new TrashRestore(TrashRestoreOutcome.Rooted)
                : new TrashRestore(TrashRestoreOutcome.Restored, placement.FolderId, placement.FolderName);
        }, cancellationToken);

    public Task PurgeNoteAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            var held = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);
            var noteIds = held.Where(pair => pair.Value == entryId).Select(pair => pair.Key).ToList();
            if (noteIds.Count == 0)
                return true;

            await DestroyNoteRowsAsync(conn, tx, noteIds, ct).ConfigureAwait(false);

            foreach (var noteId in noteIds)
                held.Remove(noteId);
            await WriteValueAsync(conn, tx, NoteTrashKey, held, ct).ConfigureAwait(false);
            return true;
        }, cancellationToken);

    public async Task<bool> NoteHoldsAsync(string entryId, CancellationToken cancellationToken = default)
    {
        var notes = await ReadMapAsync(NoteTrashKey, cancellationToken).ConfigureAwait(false);
        if (!notes.Values.Contains(entryId))
            return false;

        var folders = await ReadMapAsync(FolderTrashKey, cancellationToken).ConfigureAwait(false);
        return !folders.Values.Contains(entryId);
    }

    public async Task<IReadOnlyCollection<string>> HeldNoteEntryIdsAsync(CancellationToken cancellationToken = default)
    {
        var notes = await ReadMapAsync(NoteTrashKey, cancellationToken).ConfigureAwait(false);
        var folders = await ReadMapAsync(FolderTrashKey, cancellationToken).ConfigureAwait(false);
        var folderEntries = folders.Values.ToHashSet(StringComparer.Ordinal);
        return notes.Values.Where(entry => !folderEntries.Contains(entry)).ToHashSet(StringComparer.Ordinal);
    }

    public Task ReleaseNotesAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            await ClearMarksAsync(conn, tx, NoteTrashKey, entryIds, ct).ConfigureAwait(false);
            return true;
        }, cancellationToken);

    // ---- Folders ---------------------------------------------------------------------------------

    public Task<TrashSnapshot?> PrepareFolderAsync(string folderId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            var held = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
            if (held.ContainsKey(folderId))
                return null;

            var folder = await ReadValueAsync<NoteFolder>(conn, tx, FolderKey(folderId), ct).ConfigureAwait(false);
            if (folder is null)
                return null;

            var subtree = await LiveSubtreeAsync(conn, tx, folderId, entryId: null, ct).ConfigureAwait(false);
            var contained = await CountNotesInAsync(conn, tx, subtree, entryId: null, ct).ConfigureAwait(false);
            var origin = await FolderNameAsync(conn, tx, folder.ParentId, ct).ConfigureAwait(false);
            return new TrashSnapshot(folder.Name, origin, contained);
        }, cancellationToken);

    public Task<TrashSnapshot?> CaptureFolderAsync(string folderId, string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            var heldFolders = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
            if (heldFolders.TryGetValue(folderId, out var owner) && owner != entryId)
                return null;

            var folder = await ReadValueAsync<NoteFolder>(conn, tx, FolderKey(folderId), ct).ConfigureAwait(false);
            if (folder is null)
                return null;

            var subtree = await LiveSubtreeAsync(conn, tx, folderId, entryId, ct).ConfigureAwait(false);
            foreach (var id in subtree)
                heldFolders[id] = entryId;
            await WriteValueAsync(conn, tx, FolderTrashKey, heldFolders, ct).ConfigureAwait(false);

            var heldNotes = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);
            var contained = 0;
            foreach (var noteId in await ListNoteIdsAsync(conn, tx, ct).ConfigureAwait(false))
            {
                if (heldNotes.TryGetValue(noteId, out var noteOwner) && noteOwner != entryId)
                    continue;

                var note = await ReadValueAsync<Note>(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
                if (note?.FolderId is null || !subtree.Contains(note.FolderId))
                    continue;

                heldNotes[noteId] = entryId;
                contained++;
            }

            await WriteValueAsync(conn, tx, NoteTrashKey, heldNotes, ct).ConfigureAwait(false);

            var origin = await FolderNameAsync(conn, tx, folder.ParentId, ct).ConfigureAwait(false);
            return new TrashSnapshot(folder.Name, origin, contained);
        }, cancellationToken);

    public Task<TrashRestore> RestoreFolderAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            var heldFolders = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
            var owned = heldFolders.Where(pair => pair.Value == entryId).Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal);
            if (owned.Count == 0)
                return new TrashRestore(TrashRestoreOutcome.Missing);

            // The entry's root folder is the one whose parent this entry does not also hold.
            NoteFolder? root = null;
            foreach (var id in owned)
            {
                var folder = await ReadValueAsync<NoteFolder>(conn, tx, FolderKey(id), ct).ConfigureAwait(false);
                if (folder is null)
                    continue;
                if (folder.ParentId is null || !owned.Contains(folder.ParentId))
                {
                    root = folder;
                    break;
                }
            }

            if (root is null)
                return new TrashRestore(TrashRestoreOutcome.Missing);

            var placement = await ResolvePlacementAsync(conn, tx, root.ParentId, ct).ConfigureAwait(false);
            if (placement.Outcome == TrashRestoreOutcome.BlockedByContainer)
                return new TrashRestore(TrashRestoreOutcome.BlockedByContainer);

            if (placement.Outcome == TrashRestoreOutcome.Rooted)
            {
                root.ParentId = null;
                await WriteValueAsync(conn, tx, FolderKey(root.FolderId), root, ct).ConfigureAwait(false);
            }

            await ClearMarksAsync(conn, tx, FolderTrashKey, [entryId], ct).ConfigureAwait(false);
            await ClearMarksAsync(conn, tx, NoteTrashKey, [entryId], ct).ConfigureAwait(false);

            return placement.Outcome == TrashRestoreOutcome.Rooted
                ? new TrashRestore(TrashRestoreOutcome.Rooted)
                : new TrashRestore(TrashRestoreOutcome.Restored, placement.FolderId, placement.FolderName);
        }, cancellationToken);

    public Task<TrashPurge> PurgeFolderAsync(string entryId, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            // Nothing cascades here: a folder is a row of its own and holds no reference to the notes
            // filed in it, so destroying one can never reach a row another entry is holding. A folder
            // left behind with a parent that is gone reads as a root folder, which is what it now is.
            var heldFolders = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
            var folderIds = heldFolders.Where(pair => pair.Value == entryId).Select(pair => pair.Key).ToList();
            foreach (var folderId in folderIds)
            {
                await DestroyFolderRowAsync(conn, tx, folderId, ct).ConfigureAwait(false);
                heldFolders.Remove(folderId);
            }

            await WriteValueAsync(conn, tx, FolderTrashKey, heldFolders, ct).ConfigureAwait(false);

            var heldNotes = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);
            var noteIds = heldNotes.Where(pair => pair.Value == entryId).Select(pair => pair.Key).ToList();
            if (noteIds.Count > 0)
            {
                await DestroyNoteRowsAsync(conn, tx, noteIds, ct).ConfigureAwait(false);
                foreach (var noteId in noteIds)
                    heldNotes.Remove(noteId);
                await WriteValueAsync(conn, tx, NoteTrashKey, heldNotes, ct).ConfigureAwait(false);
            }

            return TrashPurge.Done();
        }, cancellationToken);

    public async Task<bool> FolderHoldsAsync(string entryId, CancellationToken cancellationToken = default)
    {
        var folders = await ReadMapAsync(FolderTrashKey, cancellationToken).ConfigureAwait(false);
        return folders.Values.Contains(entryId);
    }

    public async Task<IReadOnlyCollection<string>> HeldFolderEntryIdsAsync(CancellationToken cancellationToken = default)
    {
        var folders = await ReadMapAsync(FolderTrashKey, cancellationToken).ConfigureAwait(false);
        return folders.Values.ToHashSet(StringComparer.Ordinal);
    }

    public Task ReleaseFoldersAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default) =>
        WriteAsync(async (conn, tx, ct) =>
        {
            await ClearMarksAsync(conn, tx, FolderTrashKey, entryIds, ct).ConfigureAwait(false);
            await ClearMarksAsync(conn, tx, NoteTrashKey, entryIds, ct).ConfigureAwait(false);
            return true;
        }, cancellationToken);

    // ---- Shared ----------------------------------------------------------------------------------

    /// <summary>Where an item filed in <paramref name="folderId"/> would come back to.</summary>
    private static async Task<(TrashRestoreOutcome Outcome, string? FolderId, string? FolderName)> ResolvePlacementAsync(
        SqliteConnection conn, SqliteTransaction tx, string? folderId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(folderId))
            return (TrashRestoreOutcome.Restored, null, null);

        var held = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
        if (held.ContainsKey(folderId))
            return (TrashRestoreOutcome.BlockedByContainer, null, null);

        var folder = await ReadValueAsync<NoteFolder>(conn, tx, FolderKey(folderId), ct).ConfigureAwait(false);
        return folder is null
            ? (TrashRestoreOutcome.Rooted, null, null)
            : (TrashRestoreOutcome.Restored, folder.FolderId, folder.Name);
    }

    private static async Task<TrashSnapshot?> NoteSnapshotAsync(
        SqliteConnection conn, SqliteTransaction tx, string noteId, CancellationToken ct)
    {
        var note = await ReadValueAsync<Note>(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
        if (note is null)
            return null;

        var origin = await FolderNameAsync(conn, tx, note.FolderId, ct).ConfigureAwait(false);
        return new TrashSnapshot(note.Title, origin, 0);
    }

    /// <summary>The name of a live folder, or null when it is missing or itself held.</summary>
    private static async Task<string?> FolderNameAsync(
        SqliteConnection conn, SqliteTransaction tx, string? folderId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(folderId))
            return null;

        var held = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
        if (held.ContainsKey(folderId))
            return null;

        var folder = await ReadValueAsync<NoteFolder>(conn, tx, FolderKey(folderId), ct).ConfigureAwait(false);
        return folder?.Name;
    }

    /// <summary>
    /// The folder and everything under it that nothing else has taken. Passing an entry id also walks
    /// through what that entry already holds, so re-capturing reaches the same set.
    /// </summary>
    private static async Task<HashSet<string>> LiveSubtreeAsync(
        SqliteConnection conn, SqliteTransaction tx, string rootId, string? entryId, CancellationToken ct)
    {
        var held = await ReadMapAsync(conn, tx, FolderTrashKey, ct).ConfigureAwait(false);
        var index = await ReadValueAsync<List<string>>(conn, tx, FolderIndexKey, ct).ConfigureAwait(false) ?? [];

        var children = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var id in index)
        {
            if (held.TryGetValue(id, out var owner) && owner != entryId)
                continue;

            var folder = await ReadValueAsync<NoteFolder>(conn, tx, FolderKey(id), ct).ConfigureAwait(false);
            if (folder?.ParentId is null)
                continue;

            if (!children.TryGetValue(folder.ParentId, out var bucket))
                children[folder.ParentId] = bucket = [];
            bucket.Add(id);
        }

        var subtree = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>();
        pending.Push(rootId);
        while (pending.Count > 0)
        {
            var id = pending.Pop();
            if (!subtree.Add(id) || !children.TryGetValue(id, out var bucket))
                continue;
            foreach (var child in bucket)
                pending.Push(child);
        }

        return subtree;
    }

    private static async Task<int> CountNotesInAsync(
        SqliteConnection conn, SqliteTransaction tx, HashSet<string> folderIds, string? entryId, CancellationToken ct)
    {
        var held = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);
        var count = 0;
        foreach (var noteId in await ListNoteIdsAsync(conn, tx, ct).ConfigureAwait(false))
        {
            if (held.TryGetValue(noteId, out var owner) && owner != entryId)
                continue;

            var note = await ReadValueAsync<Note>(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
            if (note?.FolderId is not null && folderIds.Contains(note.FolderId))
                count++;
        }

        return count;
    }

    private static async Task<List<string>> ListNoteIdsAsync(SqliteConnection conn, SqliteTransaction tx, CancellationToken ct) =>
        await ReadValueAsync<List<string>>(conn, tx, IndexKey, ct).ConfigureAwait(false) ?? [];

    private static async Task DestroyNoteRowsAsync(
        SqliteConnection conn, SqliteTransaction tx, IReadOnlyCollection<string> noteIds, CancellationToken ct)
    {
        var index = await ReadValueAsync<List<string>>(conn, tx, IndexKey, ct).ConfigureAwait(false) ?? [];
        var changed = false;
        foreach (var noteId in noteIds)
        {
            changed |= index.Remove(noteId);
            await DeleteValueAsync(conn, tx, NoteKey(noteId), ct).ConfigureAwait(false);
            await DeleteValueAsync(conn, tx, CommitKey(noteId), ct).ConfigureAwait(false);
        }

        if (changed)
            await WriteValueAsync(conn, tx, IndexKey, index, ct).ConfigureAwait(false);
    }

    private static async Task DestroyFolderRowAsync(
        SqliteConnection conn, SqliteTransaction tx, string folderId, CancellationToken ct)
    {
        await DeleteValueAsync(conn, tx, FolderKey(folderId), ct).ConfigureAwait(false);

        var index = await ReadValueAsync<List<string>>(conn, tx, FolderIndexKey, ct).ConfigureAwait(false) ?? [];
        if (index.Remove(folderId))
            await WriteValueAsync(conn, tx, FolderIndexKey, index, ct).ConfigureAwait(false);
    }

    private static async Task ClearMarksAsync(
        SqliteConnection conn, SqliteTransaction tx, string key, IReadOnlyCollection<string> entryIds, CancellationToken ct)
    {
        if (entryIds.Count == 0)
            return;

        var map = await ReadMapAsync(conn, tx, key, ct).ConfigureAwait(false);
        var wanted = entryIds.ToHashSet(StringComparer.Ordinal);
        var removed = map.Where(pair => wanted.Contains(pair.Value)).Select(pair => pair.Key).ToList();
        if (removed.Count == 0)
            return;

        foreach (var id in removed)
            map.Remove(id);
        await WriteValueAsync(conn, tx, key, map, ct).ConfigureAwait(false);
    }

    private static async Task<Dictionary<string, string>> ReadMapAsync(
        SqliteConnection conn, SqliteTransaction tx, string key, CancellationToken ct) =>
        await ReadValueAsync<Dictionary<string, string>>(conn, tx, key, ct).ConfigureAwait(false) ?? [];

    /// <summary>
    /// Reads one trash map off a short-lived connection rather than the writer, so the read paths that
    /// consult it on every listing do not queue behind whatever is being written.
    /// </summary>
    private async Task<IReadOnlyDictionary<string, string>> ReadMapAsync(string key, CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);

        await using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Value FROM Storage WHERE Key = $key";
        cmd.Parameters.AddWithValue("$key", key);
        var value = await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
        if (value is null)
            return new Dictionary<string, string>(StringComparer.Ordinal);

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(value)
                ?? new Dictionary<string, string>(StringComparer.Ordinal);
        }
        catch (JsonException ex)
        {
            // Unreadable here would mean silently showing deleted items again, so it fails loudly.
            throw new InvalidOperationException($"The trash map '{key}' could not be read.", ex);
        }
    }

    /// <summary>Whether the trash is holding a note, for the write paths that must refuse one.</summary>
    private static async Task<bool> IsNoteHeldAsync(
        SqliteConnection conn, SqliteTransaction tx, string noteId, CancellationToken ct)
    {
        var held = await ReadMapAsync(conn, tx, NoteTrashKey, ct).ConfigureAwait(false);
        return held.ContainsKey(noteId);
    }
}
