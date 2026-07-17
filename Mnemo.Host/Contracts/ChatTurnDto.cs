using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A request to run one assistant turn against a conversation. The client mints
/// <see cref="TurnId"/> (used to cancel), sends the user's <see cref="Message"/>, and
/// picks the response-length <see cref="AssistantMode"/> (Short/Normal/Detailed).
/// </summary>
public sealed record ChatTurnRequestDto(string TurnId, string Message, string? AssistantMode);

/// <summary>
/// A tool call as it crosses the turn stream. The same call arrives twice — once
/// <c>running</c>, once <c>completed</c>/<c>failed</c> — correlated by <see cref="Id"/>,
/// so the SPA trace can show a spinner that resolves into a check or an error.
/// </summary>
public sealed record ChatToolEventDto(string Id, string Name, string? Arguments, string? Result, string Stage)
{
    public static ChatToolEventDto From(ChatToolCall call) => new(
        call.ToolCallId,
        call.Name,
        call.ArgumentsJson,
        call.ResultContent,
        call.Stage switch
        {
            ChatToolCallStage.Running => "running",
            ChatToolCallStage.Failed => "failed",
            _ => "completed",
        });
}
