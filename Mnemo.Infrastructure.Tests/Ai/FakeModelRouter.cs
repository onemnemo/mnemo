using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>Router returning fixed results and recording the chat roles it was asked to resolve.</summary>
internal sealed class FakeModelRouter : IModelRouter
{
    private readonly ChatRouteResult _chatResult;
    private readonly TextRouteResult _textResult;

    public List<AiRole> ResolvedChatRoles { get; } = new();

    public FakeModelRouter(ChatRouteResult chatResult, TextRouteResult? textResult = null)
    {
        _chatResult = chatResult;
        _textResult = textResult ?? new TextRouteResult(AiRouteStatus.NoBinding);
    }

    public static FakeModelRouter Available(IChatModelClient client, string modelId = "test-model")
        => new(new ChatRouteResult(AiRouteStatus.Available, new ChatModelBinding(client, modelId)));

    public static FakeModelRouter Unavailable(AiRouteStatus status = AiRouteStatus.NoBinding)
        => new(new ChatRouteResult(status));

    public Task<ChatRouteResult> ResolveChatAsync(AiRole role, CancellationToken ct = default)
    {
        ResolvedChatRoles.Add(role);
        return Task.FromResult(_chatResult);
    }

    public Task<TextRouteResult> ResolveTextAsync(AiRole role, CancellationToken ct = default)
        => Task.FromResult(_textResult);
}
