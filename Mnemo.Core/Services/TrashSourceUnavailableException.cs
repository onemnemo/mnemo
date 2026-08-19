using System;

namespace Mnemo.Core.Services;

/// <summary>
/// Thrown when a source cannot say whether it holds an item, so the coordinator refuses to guess.
/// The ledger row is left as it is and reconciliation is woken to settle it.
/// </summary>
public sealed class TrashSourceUnavailableException(string kind, Exception? innerException = null)
    : InvalidOperationException($"The trash source for '{kind}' could not report what it holds.", innerException)
{
    /// <summary>The kind whose source could not answer.</summary>
    public string Kind { get; } = kind;
}
