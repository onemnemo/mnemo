using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Accumulates streaming tool-call deltas from the OpenAI-compatible SSE format into
/// complete <see cref="ToolCallRequest"/> instances.
///
/// Each tool call arrives across multiple SSE chunks:
///   delta.tool_calls[i].id         : first chunk for that index (may be null on continuations)
///   delta.tool_calls[i].function.name       : first chunk
///   delta.tool_calls[i].function.arguments  : one or more partial JSON strings
/// </summary>
internal sealed class ToolCallParser
{
    private sealed class PartialCall
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public StringBuilder Arguments { get; } = new();
    }

    private readonly Dictionary<int, PartialCall> _calls = new();

    /// <summary>
    /// Feed a single delta element from choices[0].delta.tool_calls array.
    /// Returns nothing; call <see cref="BuildCompleted"/> after the stream ends.
    /// </summary>
    public void AccumulateDelta(JsonElement toolCallDelta)
    {
        if (!toolCallDelta.TryGetProperty("index", out var indexEl))
            return;

        var index = indexEl.GetInt32();
        if (!_calls.TryGetValue(index, out var partial))
        {
            partial = new PartialCall();
            _calls[index] = partial;
        }

        if (toolCallDelta.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String)
        {
            var id = idEl.GetString();
            if (!string.IsNullOrEmpty(id))
                partial.Id = id;
        }

        if (toolCallDelta.TryGetProperty("function", out var funcEl))
        {
            if (funcEl.TryGetProperty("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String)
            {
                var name = nameEl.GetString();
                if (!string.IsNullOrEmpty(name))
                    partial.Name = name;
            }

            if (funcEl.TryGetProperty("arguments", out var argsEl) && argsEl.ValueKind == JsonValueKind.String)
            {
                partial.Arguments.Append(argsEl.GetString());
            }
        }
    }

    public bool HasCalls => _calls.Count > 0;

    /// <summary>
    /// Returns all accumulated tool calls as completed <see cref="ToolCallRequest"/> instances.
    /// Call this only after the stream finishes (finish_reason == "tool_calls").
    /// </summary>
    public IReadOnlyList<ToolCallRequest> BuildCompleted()
    {
        var results = new List<ToolCallRequest>(_calls.Count);
        foreach (var (_, partial) in _calls)
        {
            results.Add(new ToolCallRequest(
                Id: string.IsNullOrEmpty(partial.Id) ? $"call_{results.Count}" : partial.Id,
                Name: partial.Name,
                ArgumentsJson: partial.Arguments.ToString()));
        }
        return results;
    }
}
