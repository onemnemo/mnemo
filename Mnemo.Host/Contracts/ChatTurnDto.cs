using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A request to run one assistant turn against a conversation. The client mints
/// <see cref="TurnId"/> (used to cancel), sends the user's <see cref="Message"/>, and
/// picks the response-length <see cref="AssistantMode"/> (Short/Normal/Detailed).
///
/// <see cref="TruncateFromIndex"/> drives edit-and-resend and regenerate: when set, the
/// conversation is cut to that message index before this turn runs, so the removed tail
/// leaves both the context window and the stored transcript. The cut is applied only when
/// the turn succeeds (a failed turn persists nothing), so a failed edit/regenerate never
/// destroys the messages it was replacing.
///
/// <see cref="Attachments"/> are files the client already uploaded (via the assets endpoint)
/// and now attaches to this user message; they are recorded on the persisted message for
/// display and reload. Like the desktop, they are not fed to the model.
/// </summary>
public sealed record ChatTurnRequestDto(
    string TurnId,
    string Message,
    string? AssistantMode,
    int? TruncateFromIndex = null,
    IReadOnlyList<ChatAssetDto>? Attachments = null);

/// <summary>
/// A tool call as it crosses the turn stream. The same call arrives twice (once
/// <c>running</c>, once <c>completed</c>/<c>failed</c>), correlated by <see cref="Id"/>,
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
