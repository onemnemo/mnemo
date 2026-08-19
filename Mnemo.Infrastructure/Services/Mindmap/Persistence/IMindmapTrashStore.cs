using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Trash;

namespace Mnemo.Infrastructure.Services.Mindmap.Persistence;

/// <summary>
/// The mindmap store's trash surface: marking rows as held, letting them go again, and destroying
/// them for good. Kept apart from <see cref="IMindmapStore"/> so ordinary persistence keeps reading
/// as the one live view of the library.
/// </summary>
/// <remarks>
/// Every method here commits on the store's own writer, so a capture and a save can never interleave.
/// The two halves are separate because a map and a folder answer different questions: a folder takes
/// a subtree with it and can be blocked by a cascade, a map takes only itself and never is.
/// </remarks>
public interface IMindmapTrashStore
{
    /// <summary>What a live map would show in the trash, or null when it is not live.</summary>
    Task<TrashSnapshot?> PrepareMapAsync(string mapId, CancellationToken cancellationToken = default);

    /// <summary>Marks a live map as held by the entry, and reports what was taken.</summary>
    Task<TrashSnapshot?> CaptureMapAsync(string mapId, string entryId, CancellationToken cancellationToken = default);

    /// <summary>Clears the entry's mark from the map it holds, rooting it if its folder is gone.</summary>
    Task<TrashRestore> RestoreMapAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Destroys the map the entry holds and queues the files it owned.</summary>
    Task PurgeMapAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Whether a map row carries this entry's mark.</summary>
    Task<bool> MapHoldsAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Every entry id currently marking a map and nothing else.</summary>
    Task<IReadOnlyCollection<string>> HeldMapEntryIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>Clears map marks without emitting restore copy, for reconciliation.</summary>
    Task ReleaseMapsAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default);

    /// <summary>What a live folder would show in the trash, or null when it is not live.</summary>
    Task<TrashSnapshot?> PrepareFolderAsync(string folderId, CancellationToken cancellationToken = default);

    /// <summary>Marks a live folder and its live subtree as held by the entry.</summary>
    Task<TrashSnapshot?> CaptureFolderAsync(string folderId, string entryId, CancellationToken cancellationToken = default);

    /// <summary>Clears the entry's marks from the folder subtree it holds.</summary>
    Task<TrashRestore> RestoreFolderAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Destroys the folder subtree the entry holds, unless a cascade would reach another entry.</summary>
    Task<TrashPurge> PurgeFolderAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Whether a folder row carries this entry's mark.</summary>
    Task<bool> FolderHoldsAsync(string entryId, CancellationToken cancellationToken = default);

    /// <summary>Every entry id currently marking a folder.</summary>
    Task<IReadOnlyCollection<string>> HeldFolderEntryIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>Clears folder marks without emitting restore copy, for reconciliation.</summary>
    Task ReleaseFoldersAsync(IReadOnlyCollection<string> entryIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// Every map id in the database, held ones included. For a walk that has to see everything the
    /// store owns rather than everything the library shows, such as deciding whether a file is still
    /// referenced.
    /// </summary>
    Task<IReadOnlyList<string>> ListAllOwnedIdsAsync(CancellationToken cancellationToken = default);

    /// <summary>Reads one map whether or not the trash holds it. Pairs with <see cref="ListAllOwnedIdsAsync"/>.</summary>
    Task<MindmapDocument?> LoadAllOwnedAsync(string id, CancellationToken cancellationToken = default);
}
