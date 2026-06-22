namespace Mnemo.Core.Models;

/// <summary>A single tool call the assistant made, plus the result returned to it. Used for UI process-step display.</summary>
public sealed class ChatToolCall
{
    public string ToolCallId { get; init; } = "";
    public string Name { get; init; } = "";
    public string? ArgumentsJson { get; init; }
    public string? ResultContent { get; init; }
}
