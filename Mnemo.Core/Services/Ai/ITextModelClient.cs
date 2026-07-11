using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;

namespace Mnemo.Core.Services.Ai;

/// <summary>
/// A single-shot completion client for the utility plane: short, low-latency text
/// generation (rewrite, tab completion, titles, summaries) with no tools and no history.
/// </summary>
/// <remarks>
/// Implementations are provider adapters (cloud or local) and stay feature-agnostic:
/// features receive a bound client from <see cref="IModelRouter"/> for their
/// <see cref="AiRole"/>.
/// </remarks>
public interface ITextModelClient
{
    /// <summary>Completes <paramref name="request"/> in one round trip (no streaming).</summary>
    /// <remarks>
    /// Terminal failures throw <see cref="AiClientException"/> after any internal retries;
    /// cancellation surfaces as <see cref="System.OperationCanceledException"/>.
    /// </remarks>
    /// <param name="request">Prompt, optional FIM suffix, and generation options.</param>
    /// <param name="ct">Cancels the request.</param>
    Task<TextCompletion> CompleteAsync(TextCompletionRequest request, CancellationToken ct = default);
}
