using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

/// <summary>
/// Computes positions for one cluster from a <see cref="LayoutSnapshot"/>. Dispatches to the
/// registered <see cref="IMindmapLayoutProvider"/> for the snapshot's algorithm, running it off the UI
/// thread and honoring cancellation (rapid re-edits cancel in-flight passes). An unknown algorithm id falls
/// back to <see cref="MindmapLayoutAlgorithms.Balanced"/> with a logged warning.
/// </summary>
public interface IMindmapLayoutService
{
    Task<Result<LayoutResult>> ComputeAsync(LayoutSnapshot snapshot, CancellationToken cancellationToken = default);
}
