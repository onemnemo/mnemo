namespace Mnemo.Core.Models.Ai;

/// <summary>Outcome of checking an API key against the provider.</summary>
/// <param name="IsValid">Whether the provider accepted the key.</param>
/// <param name="FailureKind">Why validation failed, when it did (invalid key, network, …).</param>
/// <param name="CreditsUsed">USD already spent on this key, when the provider reports it.</param>
/// <param name="CreditsLimit">USD spending cap on this key; null means no cap or not reported.</param>
public sealed record AiKeyValidationResult(
    bool IsValid,
    AiClientErrorKind? FailureKind = null,
    decimal? CreditsUsed = null,
    decimal? CreditsLimit = null);
