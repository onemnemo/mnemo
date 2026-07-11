using System;

namespace Mnemo.Core.Models.Ai;

/// <summary>What went wrong on a model-client call, in UI-mappable categories.</summary>
public enum AiClientErrorKind
{
    /// <summary>The API key is missing, malformed, or rejected by the provider.</summary>
    InvalidApiKey = 0,

    /// <summary>The account has no credits or quota left.</summary>
    InsufficientCredits = 1,

    /// <summary>The provider rate-limited the request (after client-side retries were exhausted).</summary>
    RateLimited = 2,

    /// <summary>The requested model does not exist or is currently unavailable.</summary>
    ModelUnavailable = 3,

    /// <summary>The network is unreachable or the connection failed.</summary>
    Network = 4,

    /// <summary>The provider did not answer in time.</summary>
    Timeout = 5,

    /// <summary>The provider rejected the request as malformed (a Mnemo bug, not a user problem).</summary>
    InvalidRequest = 6,

    /// <summary>Anything else.</summary>
    Unknown = 7,
}

/// <summary>
/// A terminal failure from a model client, categorized so the UI can present an honest,
/// localized error state. Thrown by <c>IChatModelClient</c> / <c>ITextModelClient</c>
/// implementations after any internal retries are exhausted.
/// </summary>
public sealed class AiClientException : Exception
{
    /// <summary>The failure category.</summary>
    public AiClientErrorKind Kind { get; }

    /// <summary>HTTP status of the failing response, when the failure came from an HTTP reply.</summary>
    public int? HttpStatus { get; }

    public AiClientException(AiClientErrorKind kind, string message, int? httpStatus = null, Exception? innerException = null)
        : base(message, innerException)
    {
        Kind = kind;
        HttpStatus = httpStatus;
    }
}
