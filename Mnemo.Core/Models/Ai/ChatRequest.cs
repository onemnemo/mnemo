using System.Collections.Generic;

namespace Mnemo.Core.Models.Ai;

/// <summary>
/// How much effort a reasoning-capable model should spend thinking.
/// Absent (<c>null</c> on the request) means the model's default.
/// </summary>
public enum ChatReasoningEffort
{
    /// <summary>Minimal reasoning; fastest responses.</summary>
    Low = 0,

    /// <summary>Balanced reasoning.</summary>
    Medium = 1,

    /// <summary>Maximum reasoning; for hard multi-step work.</summary>
    High = 2,
}

/// <summary>Everything a chat model needs for one turn: messages, tools, and generation options.</summary>
public sealed record ChatRequest
{
    /// <summary>Provider model id to run (chosen by the router, never by features).</summary>
    public required string ModelId { get; init; }

    /// <summary>Full message list, oldest first, with the system prompt as the first message.</summary>
    public required IReadOnlyList<ChatMessage> Messages { get; init; }

    /// <summary>Tools the model may call natively; null or empty disables tool calling.</summary>
    public IReadOnlyList<ChatToolDefinition>? Tools { get; init; }

    /// <summary>When set, constrains output to this JSON schema (native structured output).</summary>
    public ChatResponseSchema? ResponseSchema { get; init; }

    /// <summary>Sampling temperature; null = provider default.</summary>
    public double? Temperature { get; init; }

    /// <summary>Hard cap on generated tokens; null = provider default.</summary>
    public int? MaxOutputTokens { get; init; }

    /// <summary>Reasoning effort for reasoning-capable models; null = model default.</summary>
    public ChatReasoningEffort? ReasoningEffort { get; init; }
}
