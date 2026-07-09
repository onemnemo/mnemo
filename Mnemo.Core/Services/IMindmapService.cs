using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// Schema v2 mindmap service: document lifecycle plus the single batch-first mutation entry point that
/// backs both UI gestures and AI tool ops. The surface is derived from the tool op table — there is no
/// method that does not serve an op or a document-lifecycle need.
/// </summary>
/// <remarks>
/// All mutation flows through <see cref="ApplyAsync"/> so invariants (forest/cycle/cascade) are enforced
/// in exactly one place and every change is an atomic, revisioned batch.
/// </remarks>
public interface IMindmapService
{
    /// <summary>Create a new map, optionally seeded from a nested outline in one call (<c>create_mindmap</c>).</summary>
    Task<Result<MindmapDocument>> CreateAsync(
        string title,
        IReadOnlyList<MindmapNodeSpec>? outline = null,
        string? layoutAlgorithm = null,
        string? templateId = null,
        string? folderId = null,
        CancellationToken cancellationToken = default);

    /// <summary>Load the full document. Dangling edges are pruned in-memory on load.</summary>
    Task<Result<MindmapDocument>> GetAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Full-text search within one map (<c>find_in_map</c>), returning matching elements with their
    /// hierarchy breadcrumb and the current revision — the entry point into a huge map for a small model.
    /// An empty/whitespace query yields no hits (still with the current revision), never a failure.
    /// </summary>
    Task<Result<MindmapFindResult>> FindInMapAsync(string mapId, string query, int limit, CancellationToken cancellationToken = default);

    /// <summary>List document headers (title, revision, modified) without deserializing full documents.</summary>
    Task<Result<IReadOnlyList<MindmapDocumentSummary>>> ListAsync(CancellationToken cancellationToken = default);

    Task<Result> DeleteAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Renames a map (document title), bumping its revision.</summary>
    Task<Result<MindmapDocument>> RenameAsync(string id, string title, CancellationToken cancellationToken = default);

    /// <summary>Duplicates a map into a new document with regenerated element/edge ids.</summary>
    Task<Result<MindmapDocument>> DuplicateAsync(string id, string newTitle, CancellationToken cancellationToken = default);

    /// <summary>
    /// Apply an atomic edit batch against the document at <paramref name="expectedRevision"/>. Structural
    /// invariants are enforced here; the batch either fully applies (bumping the revision) or fully fails
    /// with a precise error. A stale-but-non-contending revision is rebased server-side; genuine
    /// contention returns <see cref="MindmapEditErrorCode.RevConflict"/>.
    /// </summary>
    Task<Result<MindmapEditResult>> ApplyAsync(
        string mapId,
        long expectedRevision,
        IReadOnlyList<MindmapEditOp> ops,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies a verbatim <see cref="MindmapRestoreDelta"/> (the transport for command-based
    /// undo/redo): elements/edges/clusters are restored exactly by id and the delta's ids removed, atomically,
    /// bumping the revision. Revision-checked like <see cref="ApplyAsync"/>. Returns the new revision.
    /// </summary>
    Task<Result<long>> RestoreAsync(
        string mapId,
        long expectedRevision,
        MindmapRestoreDelta delta,
        CancellationToken cancellationToken = default);

    // ---- Library organization (folders + folder membership) -------------------------------------

    /// <summary>Loads every map's full document plus its library metadata, for the library/overview page.</summary>
    Task<Result<IReadOnlyList<MindmapLibraryEntry>>> GetLibraryAsync(CancellationToken cancellationToken = default);

    Task<Result<IReadOnlyList<MindmapFolder>>> GetFoldersAsync(CancellationToken cancellationToken = default);

    /// <summary>Creates or updates a folder.</summary>
    Task<Result> SaveFolderAsync(MindmapFolder folder, CancellationToken cancellationToken = default);

    /// <summary>Deletes a folder; subfolders cascade and its maps orphan to the library root.</summary>
    Task<Result> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default);

    /// <summary>Moves a map into a folder, or to the root when <paramref name="folderId"/> is null.</summary>
    Task<Result> MoveToFolderAsync(string mapId, string? folderId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Raised after a mutation commits (create/edit/rename/delete/duplicate), on the committing thread —
    /// which is a background thread for tool-driven edits, never the semaphore-held write section.
    /// Handlers must marshal to the UI thread themselves and must not throw; a throwing handler is logged
    /// and swallowed rather than corrupting the commit.
    /// </summary>
    event EventHandler<MindmapChangedEventArgs>? Changed;
}
