using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One row in the Atlas conversation sidebar. Title is resolved server-side the same
/// way the desktop derives it (custom title, else the first user message, clamped);
/// null means "no title yet" and the SPA renders its localized "New chat" label.
/// </summary>
public sealed record ChatConversationSummaryDto(
    string Id,
    string? Title,
    DateTime LastActivityUtc)
{
    public static ChatConversationSummaryDto FromModel(ChatModulePersistedConversation c) => new(
        c.Id,
        ChatTitle.Derive(c),
        DtoTime.AsUtc(c.LastActivityUtc));
}

/// <summary>A full conversation with its messages, restored when the SPA opens a thread.</summary>
public sealed record ChatConversationDto(
    string Id,
    string? Title,
    string? CustomTitle,
    DateTime LastActivityUtc,
    string AssistantMode,
    IReadOnlyList<ChatMessageDto> Messages)
{
    public static ChatConversationDto FromModel(ChatModulePersistedConversation c) => new(
        c.Id,
        ChatTitle.Derive(c),
        string.IsNullOrWhiteSpace(c.CustomTitle) ? null : c.CustomTitle.Trim(),
        DtoTime.AsUtc(c.LastActivityUtc),
        ChatStreamingHelper.NormalizeAssistantMode(c.AssistantMode),
        (c.Messages ?? new List<ChatModulePersistedMessage>()).Select(ChatMessageDto.FromModel).ToList());
}

/// <summary>A persisted chat bubble. Mirrors <see cref="ChatModulePersistedMessage"/> minus transient UI state.</summary>
public sealed record ChatMessageDto(
    string Content,
    bool IsUser,
    DateTime TimestampUtc,
    IReadOnlyList<string>? Suggestions,
    IReadOnlyList<string>? Sources,
    IReadOnlyList<ChatAttachmentDto>? Attachments,
    string? Thoughts,
    int ThoughtsCount,
    string? ProcessHeaderText,
    string? ElapsedText,
    string? ProcessSummaryText,
    bool? ProcessThreadExpanded,
    int Feedback,
    IReadOnlyList<ChatProcessStepDto>? ProcessSteps)
{
    public static ChatMessageDto FromModel(ChatModulePersistedMessage m) => new(
        m.Content,
        m.IsUser,
        DtoTime.AsUtc(m.TimestampUtc),
        m.Suggestions,
        m.Sources,
        m.Attachments?.Select(ChatAttachmentDto.FromModel).ToList(),
        m.Thoughts,
        m.ThoughtsCount,
        m.ProcessHeaderText,
        m.ElapsedText,
        m.ProcessSummaryText,
        m.ProcessThreadExpanded,
        m.Feedback,
        m.ProcessSteps?.Select(ChatProcessStepDto.FromModel).ToList());
}

/// <summary>One row in the assistant's process trace (routing, model, a tool call, or narration).</summary>
public sealed record ChatProcessStepDto(
    string Label,
    string? Detail,
    string? Narration,
    string PhaseKind,
    bool IsComplete,
    IReadOnlyList<ChatToolCallDto>? ToolCalls)
{
    public static ChatProcessStepDto FromModel(ChatModulePersistedProcessStep s) => new(
        s.Label,
        s.Detail,
        s.Narration,
        s.PhaseKind,
        s.IsComplete,
        s.ToolCalls?.Select(ChatToolCallDto.FromModel).ToList());
}

/// <summary>One tool invocation shown under a process step.</summary>
public sealed record ChatToolCallDto(string Name, string Arguments, string Result, string Summary)
{
    public static ChatToolCallDto FromModel(ChatModulePersistedToolCallEntry t) =>
        new(t.Name, t.Arguments, t.Result, t.Summary);
}

/// <summary>The conversation's response-length mode after normalization (Short/Normal/Detailed).</summary>
public sealed record AssistantModeDto(string Mode);

/// <summary>Body (and echo) of a reader-feedback update on an assistant message: 0 none, 1 up, 2 down.</summary>
public sealed record ChatFeedbackDto(int Value);

/// <summary>
/// A message attachment as the browser sees it: kind, display name, and a served asset
/// id. The absolute local path stored on disk never crosses to the client; the client
/// fetches the bytes via <c>GET /api/chat/assets/{assetId}</c>. AssetId is null for a
/// path the host will not serve (e.g. a desktop-picked file outside the managed store).
/// </summary>
public sealed record ChatAttachmentDto(string Kind, string? DisplayName, string? AssetId)
{
    public static ChatAttachmentDto FromModel(ChatModulePersistedAttachment a) => new(
        a.Kind == ChatAttachmentKind.Image ? "image" : "file",
        a.DisplayName,
        Mnemo.Host.Chat.ChatAssetStore.AssetIdForPath(a.Path));
}

/// <summary>
/// An uploaded chat asset: the id the client references it by, its kind (image/file), and
/// the original file name. Returned by the upload endpoint and echoed back on the turn
/// request so the finished user message can record its attachments.
/// </summary>
public sealed record ChatAssetDto(string AssetId, string Kind, string? DisplayName);

/// <summary>Resolves a conversation's sidebar title the same way the desktop app does.</summary>
internal static class ChatTitle
{
    private const int MaxLength = 48;

    public static string? Derive(ChatModulePersistedConversation c)
    {
        if (!string.IsNullOrWhiteSpace(c.CustomTitle))
            return Clamp(c.CustomTitle.Trim());

        foreach (var m in c.Messages ?? new List<ChatModulePersistedMessage>())
        {
            if (!m.IsUser || string.IsNullOrWhiteSpace(m.Content))
                continue;
            return Clamp(m.Content.Trim().Replace("\r", " ").Replace("\n", " "));
        }

        return null;
    }

    private static string Clamp(string t) => t.Length > MaxLength ? t[..45] + "…" : t;
}
