namespace Mnemo.Core.Models.Ai;

/// <summary>
/// One unit of a streaming chat response: visible text, model reasoning, an assembled
/// tool call, usage accounting, or the finish signal. Closed union — pattern-match on
/// the nested types.
/// </summary>
public abstract record ChatStreamDelta
{
    private ChatStreamDelta() { }

    /// <summary>Visible answer text to append to the assistant message.</summary>
    public sealed record Content(string Text) : ChatStreamDelta;

    /// <summary>Reasoning/thinking text, streamed separately from <see cref="Content"/>.</summary>
    public sealed record Reasoning(string Text) : ChatStreamDelta;

    /// <summary>
    /// A fully assembled tool call the model wants executed. Clients buffer provider
    /// fragments internally and emit exactly one of these per complete call.
    /// </summary>
    public sealed record ToolCall(ToolCallRequest Call) : ChatStreamDelta;

    /// <summary>Token usage for the turn, when the provider reports it (typically once, at the end).</summary>
    public sealed record Usage(TokenUsage Value) : ChatStreamDelta;

    /// <summary>The provider's finish signal for the turn.</summary>
    public sealed record Finish(ChatFinishReason Reason) : ChatStreamDelta;
}
