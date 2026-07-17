using Microsoft.AspNetCore.Http;
using Mnemo.Core.Models.Ai;

namespace Mnemo.Host.Ai;

/// <summary>
/// Maps <see cref="AiClientErrorKind"/> to the two forms the API needs: the stable
/// snake_case token the SPA switches on (shared with the chat turn stream's <c>error</c>
/// event so both surfaces speak one vocabulary), and the HTTP status a failed
/// model-catalog fetch returns.
/// </summary>
internal static class AiErrorMapping
{
    /// <summary>The machine-readable token the SPA maps to a localized failure message.</summary>
    public static string ToWire(AiClientErrorKind kind) => kind switch
    {
        AiClientErrorKind.InvalidApiKey => "invalid_api_key",
        AiClientErrorKind.InsufficientCredits => "insufficient_credits",
        AiClientErrorKind.RateLimited => "rate_limited",
        AiClientErrorKind.ModelUnavailable => "model_unavailable",
        AiClientErrorKind.Network => "network",
        AiClientErrorKind.Timeout => "timeout",
        AiClientErrorKind.InvalidRequest => "invalid_request",
        _ => "unknown",
    };

    /// <summary>
    /// The HTTP status a thrown <see cref="AiClientException"/> maps to when it escapes an
    /// endpoint (per the migration plan's error-mapping table). Network and Unknown fall to 502.
    /// </summary>
    public static int ToHttpStatus(AiClientErrorKind kind) => kind switch
    {
        AiClientErrorKind.InvalidApiKey => StatusCodes.Status401Unauthorized,
        AiClientErrorKind.InsufficientCredits => StatusCodes.Status402PaymentRequired,
        AiClientErrorKind.RateLimited => StatusCodes.Status429TooManyRequests,
        AiClientErrorKind.ModelUnavailable => StatusCodes.Status503ServiceUnavailable,
        AiClientErrorKind.Timeout => StatusCodes.Status504GatewayTimeout,
        AiClientErrorKind.InvalidRequest => StatusCodes.Status400BadRequest,
        _ => StatusCodes.Status502BadGateway,
    };
}
