using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.MindmapV2;

namespace Mnemo.Core.Services;

/// <summary>
/// Schema v2 mindmap service: document lifecycle plus the single batch-first mutation entry point that
/// backs both UI gestures and AI tool ops. The surface is derived from the tool op table — there is no
/// method that does not serve an op or a document-lifecycle need.
/// </summary>
/// <remarks>
/// Named <c>IMindmapDocumentService</c> during the P1→P2 transition to coexist with the still-live v1
/// <c>IMindmapService</c>; it becomes the canonical <c>IMindmapService</c> once v1 is deleted in P2.
/// All mutation flows through <see cref="ApplyAsync"/> so invariants (forest/cycle/cascade) are enforced
/// in exactly one place and every change is an atomic, revisioned batch.
/// </remarks>
public interface IMindmapDocumentService
{
    /// <summary>Create a new map, optionally seeded from a nested outline in one call (<c>create_mindmap</c>).</summary>
    Task<Result<MindmapDocument>> CreateAsync(
        string title,
        IReadOnlyList<MindmapNodeSpec>? outline = null,
        string? layoutAlgorithm = null,
        string? templateId = null,
        CancellationToken cancellationToken = default);

    /// <summary>Load the full document. Dangling edges are pruned in-memory on load.</summary>
    Task<Result<MindmapDocument>> GetAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>List document headers (title, revision, modified) without deserializing full documents.</summary>
    Task<Result<IReadOnlyList<MindmapDocumentSummary>>> ListAsync(CancellationToken cancellationToken = default);

    Task<Result> DeleteAsync(string id, CancellationToken cancellationToken = default);

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
}
