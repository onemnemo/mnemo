using System.Collections.Generic;

namespace Mnemo.Core.Models.Ai;

/// <summary>
/// A single-shot utility-plane completion request: one prompt in, one completion out.
/// No history, no tools. The assistant plane uses <see cref="ChatRequest"/> instead.
/// </summary>
public sealed record TextCompletionRequest
{
    /// <summary>Provider model id to run (chosen by the router, never by features).</summary>
    public required string ModelId { get; init; }

    /// <summary>The text to complete; for fill-in-the-middle, the text before the cursor.</summary>
    public required string Prompt { get; init; }

    /// <summary>Text after the cursor for fill-in-the-middle completion; null for plain completion.</summary>
    public string? Suffix { get; init; }

    /// <summary>Optional instruction sent as the system message.</summary>
    public string? SystemPrompt { get; init; }

    /// <summary>Sampling temperature; null = provider default.</summary>
    public double? Temperature { get; init; }

    /// <summary>
    /// Hard cap on generated tokens; null = provider default. Utility callers should set
    /// a tight cap. These calls are meant to be short and cheap.
    /// </summary>
    public int? MaxOutputTokens { get; init; }

    /// <summary>Sequences that end generation early (e.g. a newline for single-line completions).</summary>
    public IReadOnlyList<string>? StopSequences { get; init; }
}
