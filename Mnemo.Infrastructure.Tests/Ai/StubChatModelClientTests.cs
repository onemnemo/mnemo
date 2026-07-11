using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Infrastructure.Tests.Ai;

public class StubChatModelClientTests
{
    private static ChatRequest RequestWithUser(string text) => new()
    {
        ModelId = "stub-echo",
        Messages = new[] { ChatMessage.System("sys"), ChatMessage.User(text) },
    };

    [Fact]
    public async Task StreamAsync_emits_reasoning_then_content_then_finish()
    {
        var client = new StubChatModelClient();

        var deltas = new List<ChatStreamDelta>();
        await foreach (var delta in client.StreamAsync(RequestWithUser("hello there")))
        {
            deltas.Add(delta);
        }

        Assert.IsType<ChatStreamDelta.Reasoning>(deltas[0]);
        Assert.Contains(deltas, d => d is ChatStreamDelta.Content);

        var finish = Assert.IsType<ChatStreamDelta.Finish>(deltas[^1]);
        Assert.Equal(ChatFinishReason.Stop, finish.Reason);

        // All reasoning precedes all content.
        var firstContent = deltas.FindIndex(d => d is ChatStreamDelta.Content);
        var lastReasoning = deltas.FindLastIndex(d => d is ChatStreamDelta.Reasoning);
        Assert.True(lastReasoning < firstContent);
    }

    [Fact]
    public async Task StreamAsync_echoes_last_user_message()
    {
        var client = new StubChatModelClient();

        var text = new StringBuilder();
        await foreach (var delta in client.StreamAsync(RequestWithUser("quantum tunneling")))
        {
            if (delta is ChatStreamDelta.Content content)
            {
                text.Append(content.Text);
            }
        }

        Assert.Contains("quantum tunneling", text.ToString());
    }

    [Fact]
    public async Task StreamAsync_honors_cancellation_mid_stream()
    {
        var client = new StubChatModelClient();
        using var cts = new CancellationTokenSource();

        await Assert.ThrowsAnyAsync<System.OperationCanceledException>(async () =>
        {
            await foreach (var delta in client.StreamAsync(RequestWithUser("hello"), cts.Token))
            {
                // Cancel after the first delta; the next paced delay must observe it.
                cts.Cancel();
            }
        });
    }
}
