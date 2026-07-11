using Mnemo.Core.Models.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>Maps OpenRouter HTTP status codes onto <see cref="AiClientErrorKind"/> categories.</summary>
internal static class OpenRouterErrors
{
    internal static AiClientErrorKind MapStatusToKind(int status) => status switch
    {
        401 or 403 => AiClientErrorKind.InvalidApiKey,
        402 => AiClientErrorKind.InsufficientCredits,
        404 or 410 => AiClientErrorKind.ModelUnavailable,
        408 => AiClientErrorKind.Timeout,
        429 => AiClientErrorKind.RateLimited,
        400 or 413 or 422 => AiClientErrorKind.InvalidRequest,
        // OpenRouter fronts upstream providers, so a bad gateway means the model is unreachable.
        502 or 503 => AiClientErrorKind.ModelUnavailable,
        _ => AiClientErrorKind.Unknown,
    };
}
