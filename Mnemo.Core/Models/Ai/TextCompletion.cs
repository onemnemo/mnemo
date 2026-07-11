namespace Mnemo.Core.Models.Ai;

/// <summary>The result of a utility-plane completion.</summary>
/// <param name="Text">The generated completion.</param>
/// <param name="FinishReason">Why generation stopped.</param>
/// <param name="Usage">Token/cost accounting, when the provider reports it.</param>
public sealed record TextCompletion(string Text, ChatFinishReason FinishReason, TokenUsage? Usage = null);
