using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;

namespace Mnemo.Core.Services.Ai;

/// <summary>
/// The assistant's single door to Mnemo's tools: presents skill-manifest tools as
/// provider-neutral tool definitions and dispatches model-requested calls in-process.
/// A per-tool permission gate and proposal shaping for mutating tools can be added
/// behind this same surface.
/// </summary>
public interface IAiToolGateway
{
    /// <summary>
    /// Tool definitions for the currently enabled skill set, with each manifest's
    /// JSON schema passed through verbatim.
    /// </summary>
    /// <param name="ct">Cancels manifest loading if it hasn't happened yet.</param>
    Task<IReadOnlyList<ChatToolDefinition>> GetToolDefinitionsAsync(CancellationToken ct = default);

    /// <summary>
    /// Executes a model-requested tool call and returns the result to feed back to the model.
    /// </summary>
    /// <remarks>
    /// Tool failures (unknown tool, bad arguments, handler errors) are returned as error
    /// content in the result — not thrown — so the agentic loop can relay them to the
    /// model verbatim. Only cancellation propagates as an exception.
    /// </remarks>
    /// <param name="call">The call as requested by the model.</param>
    /// <param name="scope">Ambient dispatch context (e.g. conversation routing key).</param>
    /// <param name="ct">Cancels the tool execution.</param>
    Task<ToolCallResult> DispatchAsync(ToolCallRequest call, ToolDispatchScope? scope = null, CancellationToken ct = default);
}
