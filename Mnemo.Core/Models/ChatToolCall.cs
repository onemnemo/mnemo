namespace Mnemo.Core.Models;

/// <summary>Lifecycle stage of an assistant tool call as surfaced to the UI.</summary>
public enum ChatToolCallStage
{
    /// <summary>The tool is currently executing (show progress).</summary>
    Running = 0,

    /// <summary>The tool returned a result successfully.</summary>
    Completed = 1,

    /// <summary>The tool was rejected before running or failed during execution.</summary>
    Failed = 2,
}

/// <summary>A single tool call the assistant made, plus the result returned to it. Used for UI process-step display.</summary>
public sealed class ChatToolCall
{
    public string ToolCallId { get; init; } = "";
    public string Name { get; init; } = "";
    public string? ArgumentsJson { get; init; }
    public string? ResultContent { get; init; }

    /// <summary>
    /// Where the call is in its lifecycle. The same <see cref="ToolCallId"/> is
    /// reported once as <see cref="ChatToolCallStage.Running"/> and again with
    /// the terminal stage, so the UI can show a spinner that resolves into a
    /// checkmark or error.
    /// </summary>
    public ChatToolCallStage Stage { get; init; } = ChatToolCallStage.Completed;
}
