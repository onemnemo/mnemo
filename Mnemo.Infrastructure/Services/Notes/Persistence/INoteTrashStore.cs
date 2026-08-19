using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;

namespace Mnemo.Infrastructure.Services.Notes.Persistence;

/// <summary>
/// The note writer's trash surface: taking a note or a folder out of the library without destroying
/// it, putting it back, and finishing the job.
/// </summary>
/// <remarks>
/// <para>
/// Notes are rows in a shared key and value table rather than a table of their own, so a held note is
/// recorded in one map beside the library instead of a column on the note. The map is written on the
/// same transactional writer as the note rows themselves, so a capture and a save can never interleave.
/// </para>
/// <para>
/// A held note keeps its place in the note index. That is deliberate: the asset sweep reads the index
/// to decide which files are still spoken for, and a note dropped from it would have its images
/// removed within the hour, leaving nothing worth restoring thirty days later.
/// </para>
/// </remarks>
public interface INoteTrashStore
{
    /// <summary>Every held note id mapped to the entry holding it.</summary>
    Task<IReadOnlyDictionary<string, string>> HeldNoteIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>Every held folder id mapped to the entry holding it.</summary>
    Task<IReadOnlyDictionary<string, string>> HeldFolderIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>What a live note would show in the trash, or null when it is not live.</summary>
    Task<TrashSnapshot?> PrepareNoteAsync(string noteId, CancellationToken cancellationToken = default);

    /// <summary>Marks a live note as held by the entry, and reports what was taken.</summary>
    Task<TrashSnapshot?> CaptureNoteAsync(string noteId, string entryId, CancellationToken cancellationToken = default);

    /// <summary>Clears the entry's mark from the note it holds, rooting it if its folder is gone.</summary>
    Task<TrashRestore> RestoreNoteAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Destroys the note the entry holds, along with its index entry and commit mark.</summary>
    Task PurgeNoteAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Whether a note carries this entry's mark.</summary>
    Task<bool> NoteHoldsAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Every entry id currently marking a note and nothing else.</summary>
    Task<IReadOnlyCollection<string>> HeldNoteEntryIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>Clears note marks without emitting restore copy, for reconciliation.</summary>
    Task ReleaseNotesAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default);

    /// <summary>What a live folder would show in the trash, or null when it is not live.</summary>
    Task<TrashSnapshot?> PrepareFolderAsync(string folderId, CancellationToken cancellationToken = default);

    /// <summary>Marks a live folder and its live subtree as held by the entry.</summary>
    Task<TrashSnapshot?> CaptureFolderAsync(string folderId, string entryId, CancellationToken cancellationToken = default);

    /// <summary>Clears the entry's marks from the folder subtree it holds.</summary>
    Task<TrashRestore> RestoreFolderAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Destroys the folder subtree the entry holds, unless a cascade would reach another entry.</summary>
    Task<TrashPurge> PurgeFolderAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Whether a folder carries this entry's mark.</summary>
    Task<bool> FolderHoldsAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Every entry id currently marking a folder.</summary>
    Task<IReadOnlyCollection<string>> HeldFolderEntryIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>Clears folder marks without emitting restore copy, for reconciliation.</summary>
    Task ReleaseFoldersAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default);
}
