namespace Mnemo.Core.Models.Ai;

/// <summary>Token and cost accounting for one model call, as reported by the provider.</summary>
/// <param name="PromptTokens">Tokens in the prompt/input.</param>
/// <param name="CompletionTokens">Tokens generated, including any reasoning tokens.</param>
/// <param name="ReasoningTokens">Reasoning-only tokens, when the provider itemizes them.</param>
/// <param name="CostUsd">Actual cost in USD, when the provider reports it.</param>
public sealed record TokenUsage(int PromptTokens, int CompletionTokens, int? ReasoningTokens = null, decimal? CostUsd = null)
{
    /// <summary>Prompt plus completion tokens.</summary>
    public int TotalTokens => PromptTokens + CompletionTokens;
}
