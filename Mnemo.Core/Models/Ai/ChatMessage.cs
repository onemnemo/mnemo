using System.Collections.Generic;

namespace Mnemo.Core.Models.Ai;

/// <summary>Who authored a chat message.</summary>
public enum ChatMessageRole
{
    /// <summary>Instructions to the model.</summary>
    System = 0,

    /// <summary>The user's message.</summary>
    User = 1,

    /// <summary>The model's message, optionally carrying tool calls.</summary>
    Assistant = 2,

    /// <summary>A tool result being returned to the model.</summary>
    Tool = 3,
}

/// <summary>
/// One message in a chat-model request: system, user, assistant (optionally carrying
/// tool calls), or a tool result. Mirrors the OpenAI-style message wire shape.
/// </summary>
public sealed record ChatMessage
{
    /// <summary>Who authored the message.</summary>
    public required ChatMessageRole Role { get; init; }

    /// <summary>Message text. Null on assistant turns that only carry tool calls.</summary>
    public string? Content { get; init; }

    /// <summary>Tool calls the assistant made on this turn (assistant role only).</summary>
    public IReadOnlyList<ToolCallRequest>? ToolCalls { get; init; }

    /// <summary>Id of the tool call this message answers (tool role only).</summary>
    public string? ToolCallId { get; init; }

    /// <summary>Name of the tool that produced this result (tool role only).</summary>
    public string? ToolName { get; init; }

    /// <summary>Creates a system message.</summary>
    public static ChatMessage System(string content) =>
        new() { Role = ChatMessageRole.System, Content = content };

    /// <summary>Creates a user message.</summary>
    public static ChatMessage User(string content) =>
        new() { Role = ChatMessageRole.User, Content = content };

    /// <summary>Creates a plain assistant message.</summary>
    public static ChatMessage Assistant(string content) =>
        new() { Role = ChatMessageRole.Assistant, Content = content };

    /// <summary>Creates an assistant message that requested tool calls, with optional lead-in text.</summary>
    public static ChatMessage AssistantToolCalls(IReadOnlyList<ToolCallRequest> toolCalls, string? content = null) =>
        new() { Role = ChatMessageRole.Assistant, Content = content, ToolCalls = toolCalls };

    /// <summary>Creates the tool-result message answering <paramref name="result"/>.</summary>
    public static ChatMessage ToolResult(ToolCallResult result) =>
        new() { Role = ChatMessageRole.Tool, Content = result.Content, ToolCallId = result.ToolCallId, ToolName = result.Name };
}
