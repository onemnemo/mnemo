using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// Background integrity sweep for a mindmap: lists dangling note/deck/image references so they can be
/// surfaced in the UI and as an AI tool warning. Read-only, it reports, never
/// repairs.
/// </summary>
public interface IMindmapIntegrityService
{
    /// <summary>
    /// Loads the map and checks every reference-bearing element: note refs against the note store, flashcard
    /// refs against the flashcard library, and image assets against the images directory. A missing map is a
    /// failed <see cref="Result{T}"/>; a healthy map yields a report with an empty issue list.
    /// </summary>
    Task<Result<MindmapIntegrityReport>> SweepAsync(string mapId, CancellationToken cancellationToken = default);
}
