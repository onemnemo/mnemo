using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Phase-0 router that binds every chat role to the built-in <see cref="StubChatModelClient"/>
/// and reports no text-plane binding. Replaced by a settings-driven router once real
/// provider adapters exist.
/// </summary>
public sealed class StubModelRouter : IModelRouter
{
    private readonly IChatModelClient _chatClient;

    public StubModelRouter(IChatModelClient chatClient)
    {
        _chatClient = chatClient;
    }

    /// <inheritdoc />
    public Task<ChatRouteResult> ResolveChatAsync(AiRole role, CancellationToken ct = default)
        => Task.FromResult(new ChatRouteResult(AiRouteStatus.Available, new ChatModelBinding(_chatClient, "stub-echo")));

    /// <inheritdoc />
    public Task<TextRouteResult> ResolveTextAsync(AiRole role, CancellationToken ct = default)
        // No text-plane provider exists yet; callers degrade gracefully on NoBinding.
        => Task.FromResult(new TextRouteResult(AiRouteStatus.NoBinding));
}
