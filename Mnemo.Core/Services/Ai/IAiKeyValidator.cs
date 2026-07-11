using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;

namespace Mnemo.Core.Services.Ai;

/// <summary>
/// Validates a provider API key on demand (the settings page's "Test connection").
/// </summary>
public interface IAiKeyValidator
{
    /// <summary>
    /// Checks <paramref name="apiKey"/> against the provider and reports validity plus any
    /// credit accounting the provider exposes. An invalid key or unreachable provider is an
    /// expected outcome and is reported in the result, never thrown; only cancellation throws.
    /// </summary>
    /// <param name="apiKey">The key to check, as entered by the user (may be unsaved).</param>
    /// <param name="ct">Cancels the validation request.</param>
    Task<AiKeyValidationResult> ValidateAsync(string apiKey, CancellationToken ct = default);
}
