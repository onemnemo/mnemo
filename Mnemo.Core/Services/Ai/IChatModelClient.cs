using System.Collections.Generic;
using System.Threading;
using Mnemo.Core.Models.Ai;

namespace Mnemo.Core.Services.Ai;

/// <summary>
/// A streaming chat-completion client for the assistant plane: multi-turn messages,
/// native tool calling, and optional JSON-schema-constrained output.
/// </summary>
/// <remarks>
/// Implementations are provider adapters (cloud or local) and stay feature-agnostic:
/// features never construct or select one directly. They receive a bound client from
/// <see cref="IModelRouter"/> for their <see cref="AiRole"/>.
/// </remarks>
public interface IChatModelClient
{
    /// <summary>
    /// Sends one model turn and streams response deltas as they arrive.
    /// </summary>
    /// <remarks>
    /// Tool-call deltas are emitted fully assembled. Implementations buffer provider
    /// fragments and yield one <see cref="ChatStreamDelta.ToolCall"/> per complete call.
    /// Terminal failures (invalid key, rate limit, network) throw <see cref="AiClientException"/>
    /// after any internal retries; cancellation surfaces as <see cref="System.OperationCanceledException"/>.
    /// </remarks>
    /// <param name="request">Messages, tool definitions, and generation options for this turn.</param>
    /// <param name="ct">Cancels the request and the delta stream.</param>
    IAsyncEnumerable<ChatStreamDelta> StreamAsync(ChatRequest request, CancellationToken ct = default);
}
