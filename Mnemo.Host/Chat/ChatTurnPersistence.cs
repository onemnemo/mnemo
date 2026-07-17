using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.Chat;

/// <summary>
/// Appends one completed assistant turn (the user message plus the assistant reply) to the shared
/// chat-history document via read-modify-write, the same document the desktop app persists. A new
/// conversation materializes on its first turn; the title stays derived (never stored) so it tracks
/// the first user message until the user sets a custom one.
/// </summary>
public static class ChatTurnPersistence
{
    public static async Task AppendTurnAsync(
        IChatModuleHistoryService history,
        string conversationId,
        string assistantMode,
        DateTime lastActivityUtc,
        ChatModulePersistedMessage userMessage,
        ChatModulePersistedMessage assistantMessage)
    {
        // Independent of the request lifetime: a client disconnect must not lose a finished turn.
        var load = await history.LoadAsync().ConfigureAwait(false);
        var document = load.IsSuccess && load.Value is not null
            ? load.Value
            : new ChatModuleHistoryDocument();

        var conversation = document.Conversations.FirstOrDefault(c => c.Id == conversationId);
        if (conversation is null)
        {
            conversation = new ChatModulePersistedConversation { Id = conversationId };
            document.Conversations.Add(conversation);
        }

        conversation.AssistantMode = assistantMode;
        conversation.LastActivityUtc = lastActivityUtc;
        conversation.Messages.Add(userMessage);
        conversation.Messages.Add(assistantMessage);

        await history.SaveAsync(document).ConfigureAwait(false);
    }
}
