using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.MindmapV2;

namespace Mnemo.Infrastructure.Services.MindmapV2.Persistence;

/// <summary>
/// Owns the mindmap database: the canonical document rows and the FTS text mirror, plus connection and
/// transaction mechanics. The document JSON is stored whole; the store never interprets it beyond
/// the indexed header columns. Domain rules (invariants, ids, revisions) live in the service, not here.
/// </summary>
public interface IMindmapStore
{
    /// <summary>Ensures the schema exists and is at the target version. Idempotent.</summary>
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>Loads and deserializes a document, or null if no map has that id.</summary>
    Task<MindmapDocument?> LoadAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Lists document headers from the indexed columns, without deserializing documents.</summary>
    Task<IReadOnlyList<MindmapDocumentSummary>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Upserts the document row and applies the FTS <paramref name="searchDelta"/> in a single transaction.
    /// </summary>
    Task SaveAsync(MindmapDocument document, MindmapSearchDelta searchDelta, CancellationToken cancellationToken = default);

    /// <summary>Deletes a document and all its FTS rows.</summary>
    Task DeleteAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Full-text search within one map, returning matching element ids and their indexed text.</summary>
    Task<IReadOnlyList<MindmapSearchHit>> SearchAsync(string mapId, string query, int limit, CancellationToken cancellationToken = default);

    /// <summary>Loads every map's full document plus its library metadata (folder + linked decks).</summary>
    Task<IReadOnlyList<MindmapLibraryEntry>> GetLibraryAsync(CancellationToken cancellationToken = default);

    /// <summary>Lists all library folders.</summary>
    Task<IReadOnlyList<MindmapFolder>> GetFoldersAsync(CancellationToken cancellationToken = default);

    /// <summary>Upserts a folder.</summary>
    Task SaveFolderAsync(MindmapFolder folder, CancellationToken cancellationToken = default);

    /// <summary>Deletes a folder (subfolders cascade; maps orphan to the root).</summary>
    Task DeleteFolderAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Assigns a map to a folder, or to the root when <paramref name="folderId"/> is null.</summary>
    Task SetFolderAsync(string mapId, string? folderId, CancellationToken cancellationToken = default);
}
