namespace Mnemo.Core.Models.Ai;

/// <summary>A model available from a provider, as listed in settings pickers.</summary>
public sealed record ModelDescriptor
{
    /// <summary>Provider model id (e.g. <c>deepseek/deepseek-v4-flash</c>).</summary>
    public required string Id { get; init; }

    /// <summary>Human-readable name for pickers.</summary>
    public required string DisplayName { get; init; }

    /// <summary>Maximum context window in tokens, when known.</summary>
    public long? ContextLength { get; init; }

    /// <summary>Prompt price in USD per million tokens, when known.</summary>
    public decimal? PromptPricePerMillionUsd { get; init; }

    /// <summary>Completion price in USD per million tokens, when known.</summary>
    public decimal? CompletionPricePerMillionUsd { get; init; }

    /// <summary>Whether the model supports native tool calling.</summary>
    public bool SupportsToolCalls { get; init; }

    /// <summary>Whether the model supports JSON-schema structured output.</summary>
    public bool SupportsStructuredOutput { get; init; }

    /// <summary>Whether the model can stream reasoning.</summary>
    public bool SupportsReasoning { get; init; }
}
