using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>
/// Chat client driven by a queue of scripted delta sequences (one dequeued per
/// <see cref="StreamAsync"/> call), recording every request it receives. Also supports an
/// always-emit sequence (for the round-cap test), an infinite slow stream (for cancellation),
/// and a post-sequence throw (for provider-failure paths).
/// </summary>
internal sealed class ScriptedChatModelClient : IChatModelClient
{
    private readonly Queue<IReadOnlyList<ChatStreamDelta>> _script = new();

    public List<ChatRequest> Requests { get; } = new();

    /// <summary>When set, every call emits this sequence instead of dequeuing the script.</summary>
    public IReadOnlyList<ChatStreamDelta>? AlwaysEmit { get; set; }

    /// <summary>When true, yields visible tokens forever, paced by a cancellable delay.</summary>
    public bool InfiniteSlowStream { get; set; }

    /// <summary>When set, thrown after the current sequence's deltas are emitted.</summary>
    public Exception? ThrowAfterSequence { get; set; }

    public ScriptedChatModelClient Enqueue(params ChatStreamDelta[] deltas)
    {
        _script.Enqueue(deltas);
        return this;
    }

    public async IAsyncEnumerable<ChatStreamDelta> StreamAsync(
        ChatRequest request,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        Requests.Add(request);

        if (InfiniteSlowStream)
        {
            var i = 0;
            while (true)
            {
                await Task.Delay(15, ct).ConfigureAwait(false);
                yield return new ChatStreamDelta.Content($"token{i++} ");
            }
        }

        var sequence = AlwaysEmit ?? _script.Dequeue();
        foreach (var delta in sequence)
        {
            await Task.Yield();
            yield return delta;
        }

        if (ThrowAfterSequence is not null)
        {
            throw ThrowAfterSequence;
        }
    }
}
