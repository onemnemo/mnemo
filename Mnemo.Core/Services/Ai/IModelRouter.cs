using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;

namespace Mnemo.Core.Services.Ai;

/// <summary>
/// Resolves an <see cref="AiRole"/> to a bound model client and model id, from provider
/// settings and availability. This is the single indirection behind gradual local rollout:
/// features declare roles, never models, so re-binding a role (cloud today, local later)
/// is a configuration change instead of a feature change.
/// </summary>
public interface IModelRouter
{
    /// <summary>
    /// Resolves the chat-plane binding for <paramref name="role"/>
    /// (<see cref="AiRole.Assistant"/>, <see cref="AiRole.StructuredGenerator"/>).
    /// </summary>
    /// <param name="role">The chat-plane role to resolve.</param>
    /// <param name="ct">Cancels settings/availability lookups.</param>
    Task<ChatRouteResult> ResolveChatAsync(AiRole role, CancellationToken ct = default);

    /// <summary>
    /// Resolves the text-plane binding for <paramref name="role"/>
    /// (<see cref="AiRole.Summarizer"/>, <see cref="AiRole.Rewriter"/>,
    /// <see cref="AiRole.TabCompleter"/>, <see cref="AiRole.TitleGenerator"/>).
    /// </summary>
    /// <param name="role">The text-plane role to resolve.</param>
    /// <param name="ct">Cancels settings/availability lookups.</param>
    Task<TextRouteResult> ResolveTextAsync(AiRole role, CancellationToken ct = default);
}
