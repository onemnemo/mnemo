using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Summarizes conversation history for session continuity. Runs as
/// <see cref="AiRole.Summarizer"/> so the router can serve it with a cheaper model
/// than the assistant.
/// </summary>
public sealed class ConversationSummarizer : IConversationSummarizer
{
    private const string SystemPrompt =
        "You are a conversation summarizer. Given a set of conversation turns, " +
        "produce a dense 1-3 sentence summary written as if a new assistant is " +
        "taking over mid-session. Cover: what has been done, what the user wants, " +
        "any relevant background. Be factual and concise.";

    private readonly IAIOrchestrator _orchestrator;

    public ConversationSummarizer(IAIOrchestrator orchestrator)
    {
        _orchestrator = orchestrator;
    }

    public async Task<Result<ConversationSummary>> SummarizeAsync(
        ConversationMemorySnapshot snapshot,
        IReadOnlyList<ConversationTurn> newTurnsSinceLastSummary,
        CancellationToken ct = default)
    {
        var sb = new StringBuilder();

        if (snapshot.LatestSummary is { } prev && !string.IsNullOrWhiteSpace(prev.Summary))
        {
            sb.AppendLine($"Previous summary: {prev.Summary}");
            sb.AppendLine();
        }

        foreach (ConversationTurn turn in newTurnsSinceLastSummary)
        {
            string role = turn.Role == ConversationRole.User ? "User" : "Assistant";
            sb.Append(role).Append(": ").AppendLine(turn.Content);
        }

        Result<string> result = await _orchestrator
            .PromptAsync(SystemPrompt, sb.ToString().TrimEnd(), AiRole.Summarizer, ct)
            .ConfigureAwait(false);

        if (!result.IsSuccess)
        {
            return Result<ConversationSummary>.Failure(
                result.ErrorMessage ?? "Conversation summarization failed.");
        }

        int coveredTurn = snapshot.LastSummarizedTurn + newTurnsSinceLastSummary.Count;

        return Result<ConversationSummary>.Success(new ConversationSummary
        {
            Summary = result.Value!,
            ActiveSkill = snapshot.LatestSummary?.ActiveSkill ?? "NONE",
            CoveredThroughTurn = coveredTurn,
        });
    }
}
