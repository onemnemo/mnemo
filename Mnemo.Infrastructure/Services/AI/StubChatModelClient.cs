using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Phase-0 placeholder chat provider so the assistant UI can stream end-to-end before a
/// real provider adapter exists. It echoes the user's last message behind an obvious
/// "no provider configured" notice and is replaced by a real client in Phase 1.
/// </summary>
/// <remarks>
/// English-only by decision: this is a throwaway placeholder removed when the real provider
/// lands, so its text is not routed through localization.
/// </remarks>
public sealed class StubChatModelClient : IChatModelClient
{
    /// <inheritdoc />
    public async IAsyncEnumerable<ChatStreamDelta> StreamAsync(
        ChatRequest request,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var lastUserMessage = request.Messages
            .LastOrDefault(m => m.Role == ChatMessageRole.User)?.Content ?? string.Empty;

        // Two reasoning beats so the "thinking" surface has something to show.
        yield return new ChatStreamDelta.Reasoning("Reading your message");
        await Task.Delay(15, ct).ConfigureAwait(false);
        yield return new ChatStreamDelta.Reasoning("Preparing a placeholder reply");
        await Task.Delay(15, ct).ConfigureAwait(false);

        var reply = $"No AI provider is configured yet — this is Mnemo's built-in stub. You said: \"{lastUserMessage}\"";

        // Small chunks with a short delay between them make the stream visibly incremental and cancellable mid-flight.
        foreach (var chunk in SplitIntoChunks(reply))
        {
            await Task.Delay(15, ct).ConfigureAwait(false);
            yield return new ChatStreamDelta.Content(chunk);
        }

        yield return new ChatStreamDelta.Finish(ChatFinishReason.Stop);
    }

    private static IEnumerable<string> SplitIntoChunks(string text)
    {
        var words = text.Split(' ');
        for (var i = 0; i < words.Length; i++)
        {
            // Keep the trailing space on every chunk but the last so the reassembled text is faithful.
            yield return i == words.Length - 1 ? words[i] : words[i] + " ";
        }
    }
}
