using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// Schema v2 mindmap service: document lifecycle plus the single batch-first mutation entry point that
/// backs UI gestures, AI tool ops and import alike. There is no method that does not serve an op or a
/// document-lifecycle need.
/// </summary>
/// <remarks>
/// Structural mutation flows through <see cref="ApplyAsync"/> so invariants (forest, cycles, cascade) are
/// enforced in exactly one place and every change is an atomic, revisioned batch.
/// <para>
/// Every method that commits holds the per-map write gate for the whole read-modify-write, computes its
/// own undo and redo deltas inside that gate, and answers in the shape of <see cref="MindmapEditResult"/>
/// so that no caller has a weaker path than any other. A write whose deltas were computed outside the
/// gate would describe a document nobody ever held, which is how an undo silently reverts a change it
/// never saw.
/// </para>
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

    /// <summary>
    /// Deletes a map, under the same per-map write gate every other mutation takes, so a delete racing an
    /// in-flight batch cannot leave the row behind with only that batch's elements indexed.
    /// </summary>
    Task<Result> DeleteAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Renames a map, bumping its revision and answering in the same shape an edit batch does, deltas and
    /// all: a title is document metadata rather than graph structure, but it is still a write, and a write
    /// that does not report an undo delta is a write that silently invalidates the caller's history.
    /// </summary>
    Task<Result<MindmapEditResult>> RenameAsync(string id, string title, CancellationToken cancellationToken = default);

    /// <summary>Duplicates a map into a new document with regenerated element/edge ids.</summary>
    Task<Result<MindmapDocument>> DuplicateAsync(string id, string newTitle, CancellationToken cancellationToken = default);

    /// <summary>
    /// Apply an atomic edit batch against the document at <paramref name="expectedRevision"/>. Structural
    /// invariants are enforced here; the batch either fully applies (bumping the revision) or fully fails
    /// with a precise error. A stale-but-non-contending revision is rebased onto the current document, and
    /// the result's <see cref="MindmapEditResult.BaseRevision"/> reports what it was rebased onto; genuine
    /// contention returns <see cref="MindmapEditErrorCode.RevConflict"/>.
    /// </summary>
    Task<Result<MindmapEditResult>> ApplyAsync(
        string mapId,
        long expectedRevision,
        IReadOnlyList<MindmapEditOp> ops,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies a verbatim <see cref="MindmapRestoreDelta"/>, the transport for command-based undo and
    /// redo: elements, edges and clusters are restored exactly by id, the delta's ids are removed, and the
    /// title and canvas it carries are put back, atomically, bumping the revision.
    /// <para>
    /// The revision must match exactly. There is no rebase here, because a delta is a rewrite of named
    /// rows rather than an intent: replaying one over a document that has moved on reverts whatever moved
    /// it, with no conflict to notice and no second undo to get back. The resulting document is validated
    /// against the same structural invariants an edit batch is held to, and a delta that would break one
    /// is refused whole.
    /// </para>
    /// </summary>
    Task<Result<MindmapEditResult>> RestoreAsync(
        string mapId,
        long expectedRevision,
        MindmapRestoreDelta delta,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Stores a document that was built elsewhere (a package import), under the write gate, as a new
    /// revision of whatever is already there.
    /// <para>
    /// The revision only ever moves forward: an imported document carries the revision it had in the
    /// package, which may be behind the local map it is replacing, and adopting that number would make
    /// every subsequent write look stale. The schema version is checked here rather than at first open,
    /// because a package from a newer build that is stored successfully and can never be opened is worse
    /// than one that is refused.
    /// </para>
    /// </summary>
    Task<Result<MindmapEditResult>> ReplaceAsync(
        MindmapDocument document,
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
