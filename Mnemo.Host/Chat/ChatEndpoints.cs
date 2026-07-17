using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.UI.Services;

namespace Mnemo.Host.Chat;

/// <summary>
/// Per-conversation REST over the single stored chat-history document: the SPA
/// lists, opens, renames, and deletes threads; the document read-modify-write stays
/// server-side. Turn creation and streaming live on the SSE turn endpoint, so the
/// ephemeral-until-first-message semantic is preserved by the SPA creating a thread
/// implicitly with its first turn.
/// </summary>
public static class ChatEndpoints
{
    public static void MapChat(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/chat/conversations", async (IChatModuleHistoryService history, CancellationToken ct) =>
        {
            var load = await history.LoadAsync(ct).ConfigureAwait(false);
            if (!load.IsSuccess)
                return HistoryError(load.ErrorMessage);

            var list = load.Value!.Conversations
                .OrderByDescending(c => c.LastActivityUtc)
                .Select(ChatConversationSummaryDto.FromModel)
                .ToList();
            return Results.Ok(list);
        });

        endpoints.MapGet("/api/chat/conversations/{id}", async (string id, IChatModuleHistoryService history, CancellationToken ct) =>
        {
            var load = await history.LoadAsync(ct).ConfigureAwait(false);
            if (!load.IsSuccess)
                return HistoryError(load.ErrorMessage);

            var convo = load.Value!.Conversations.FirstOrDefault(c => c.Id == id);
            return convo is null
                ? Results.NotFound()
                : Results.Ok(ChatConversationDto.FromModel(convo));
        });

        endpoints.MapPut("/api/chat/conversations/{id}/title", async (string id, UpdateSettingDto body, IChatModuleHistoryService history, CancellationToken ct) =>
        {
            var load = await history.LoadAsync(ct).ConfigureAwait(false);
            if (!load.IsSuccess)
                return HistoryError(load.ErrorMessage);

            var doc = load.Value!;
            var convo = doc.Conversations.FirstOrDefault(c => c.Id == id);
            if (convo is null)
                return Results.NotFound();

            // Empty clears the override, so the title falls back to the first user message.
            convo.CustomTitle = string.IsNullOrWhiteSpace(body.Value) ? null : body.Value.Trim();

            var save = await history.SaveAsync(doc, ct).ConfigureAwait(false);
            if (!save.IsSuccess)
                return HistoryError(save.ErrorMessage);

            return Results.Ok(ChatConversationSummaryDto.FromModel(convo));
        });

        endpoints.MapPut("/api/chat/conversations/{id}/mode", async (string id, UpdateSettingDto body, IChatModuleHistoryService history, CancellationToken ct) =>
        {
            var load = await history.LoadAsync(ct).ConfigureAwait(false);
            if (!load.IsSuccess)
                return HistoryError(load.ErrorMessage);

            var doc = load.Value!;
            var convo = doc.Conversations.FirstOrDefault(c => c.Id == id);
            if (convo is null)
                return Results.NotFound();

            // Persist a response-length change made without sending a turn (the turn endpoint
            // stamps the mode on every completed turn; this covers switching then navigating away).
            // Normalizing here folds legacy ids (General/Explainer) the same way the desktop does.
            var mode = ChatStreamingHelper.NormalizeAssistantMode(body.Value);
            convo.AssistantMode = mode;

            var save = await history.SaveAsync(doc, ct).ConfigureAwait(false);
            if (!save.IsSuccess)
                return HistoryError(save.ErrorMessage);

            return Results.Ok(new AssistantModeDto(mode));
        });

        endpoints.MapDelete("/api/chat/conversations/{id}", async (string id, IChatModuleHistoryService history, CancellationToken ct) =>
        {
            var load = await history.LoadAsync(ct).ConfigureAwait(false);
            if (!load.IsSuccess)
                return HistoryError(load.ErrorMessage);

            var doc = load.Value!;
            if (doc.Conversations.RemoveAll(c => c.Id == id) == 0)
                return Results.NotFound();

            var save = await history.SaveAsync(doc, ct).ConfigureAwait(false);
            if (!save.IsSuccess)
                return HistoryError(save.ErrorMessage);

            return Results.NoContent();
        });

        endpoints.MapDelete("/api/chat/history", async (IChatHistoryClearService clear, CancellationToken ct) =>
        {
            var result = await clear.ClearAllAsync(ct).ConfigureAwait(false);
            return result.IsSuccess ? Results.NoContent() : HistoryError(result.ErrorMessage);
        });
    }

    private static IResult HistoryError(string? message) =>
        Results.Json(new ErrorDto("chat_history_error", message ?? "Chat history operation failed."),
            statusCode: StatusCodes.Status500InternalServerError);
}
