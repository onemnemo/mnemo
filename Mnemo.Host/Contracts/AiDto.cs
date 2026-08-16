using Mnemo.Core.Models.Ai;
using Mnemo.Host.Ai;

namespace Mnemo.Host.Contracts;

/// <summary>An AI model offered by the provider, as the SPA's model pickers show it.</summary>
public sealed record AiModelDto(
    string Id,
    string DisplayName,
    long? ContextLength,
    decimal? PromptPricePerMillionUsd,
    decimal? CompletionPricePerMillionUsd,
    bool SupportsToolCalls,
    bool SupportsStructuredOutput,
    bool SupportsReasoning)
{
    public static AiModelDto FromModel(ModelDescriptor m) => new(
        m.Id,
        m.DisplayName,
        m.ContextLength,
        m.PromptPricePerMillionUsd,
        m.CompletionPricePerMillionUsd,
        m.SupportsToolCalls,
        m.SupportsStructuredOutput,
        m.SupportsReasoning);
}

/// <summary>
/// A request to test an OpenRouter key. <see cref="ApiKey"/> is the value the user typed
/// (which may be unsaved); when it is null or blank the server tests the saved key instead,
/// since the write-only-secret rule means the SPA can never read the saved key back.
/// </summary>
public sealed record AiKeyValidationRequestDto(string? ApiKey);

/// <summary>
/// Outcome of a key test. <see cref="FailureKind"/> is null on success and otherwise the same
/// snake_case token the chat turn stream uses, so the SPA maps both to one set of localized
/// messages. Credit figures appear only when the provider reports them.
/// </summary>
public sealed record AiKeyValidationResultDto(
    bool IsValid,
    string? FailureKind,
    decimal? CreditsUsed,
    decimal? CreditsLimit)
{
    public static AiKeyValidationResultDto FromModel(AiKeyValidationResult r) => new(
        r.IsValid,
        r.FailureKind is { } kind ? AiErrorMapping.ToWire(kind) : null,
        r.CreditsUsed,
        r.CreditsLimit);
}

/// <summary>The AI feature settings the SPA hydrates for the chat composer and settings page.</summary>
public sealed record AiSettingsDto(bool WebSearchEnabled);
