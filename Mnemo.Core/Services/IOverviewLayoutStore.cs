using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Core.Services;

/// <summary>
/// Persistence for the overview board layout. Implementations own schema versioning and
/// migrate legacy formats transparently on load.
/// </summary>
public interface IOverviewLayoutStore
{
    /// <summary>
    /// Loads the stored layout. Success with <c>null</c> means no layout has ever been saved
    /// (caller seeds defaults); an empty widget list is a deliberate user state and is preserved.
    /// </summary>
    Task<Result<OverviewLayout?>> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>Persists the layout atomically under the current schema version.</summary>
    Task<Result> SaveAsync(OverviewLayout layout, CancellationToken cancellationToken = default);
}
