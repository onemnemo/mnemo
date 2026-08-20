using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;

namespace Mnemo.Core.Services.Ai;

/// <summary>
/// Provides the models available from the configured provider, for settings pickers and
/// anywhere else a model must be chosen by name.
/// </summary>
public interface IModelCatalogService
{
    /// <summary>
    /// Returns the curated shortlist for model pickers: strong, tool-capable models with the
    /// pinned default first. Never throws. When the provider catalog is unreachable it falls
    /// back to built-in descriptors, so pickers always have content.
    /// </summary>
    /// <param name="ct">Cancels the catalog fetch.</param>
    Task<IReadOnlyList<ModelDescriptor>> GetCuratedModelsAsync(CancellationToken ct = default);

    /// <summary>
    /// Returns the full provider catalog, fetched and cached. Throws
    /// <see cref="Mnemo.Core.Models.Ai.AiClientException"/> when the catalog cannot be
    /// fetched and no cached copy exists.
    /// </summary>
    /// <param name="ct">Cancels the catalog fetch.</param>
    Task<IReadOnlyList<ModelDescriptor>> GetAllModelsAsync(CancellationToken ct = default);
}
