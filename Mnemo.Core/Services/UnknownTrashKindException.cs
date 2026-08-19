using System;

namespace Mnemo.Core.Services;

/// <summary>
/// Thrown when a delete request names a kind no source in this build claims.
/// </summary>
public sealed class UnknownTrashKindException(string kind)
    : InvalidOperationException($"No trash source is registered for the kind '{kind}'.")
{
    /// <summary>The kind that had no source.</summary>
    public string Kind { get; } = kind;
}
