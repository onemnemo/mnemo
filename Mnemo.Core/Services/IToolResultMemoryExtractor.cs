using System.Collections.Generic;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Extracts conversation-memory facts from a tool result JSON payload.
/// Implementations are rule-based (no LLM) and registered per-module.
/// The composite aggregator (<c>CompositeToolResultMemoryExtractor</c>) dispatches to all of them.
/// </summary>
public interface IToolResultMemoryExtractor
{
    /// <summary>
    /// Derives zero or more <see cref="ConversationMemoryEntry"/> facts from a tool invocation.
    /// </summary>
    /// <param name="toolName">The name of the tool that was called.</param>
    /// <param name="resultJson">The raw JSON string returned by the tool.</param>
    /// <param name="turnNumber">The conversation turn on which the tool was called.</param>
    IEnumerable<ConversationMemoryEntry> Extract(string toolName, string resultJson, int turnNumber);
}
