using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;

namespace Mnemo.Host.Ai;

/// <summary>
/// The availability filter for routes that can configure or run the assistant.
/// </summary>
public static class AiReady
{
    /// <summary>
    /// Makes an assistant route absent unless developer mode and the assistant switch are both on.
    /// </summary>
    public static RouteHandlerBuilder RequireAiAvailable(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var settings = context.HttpContext.RequestServices.GetRequiredService<ISettingsService>();
            if (await AiAvailability.IsEnabledAsync(settings).ConfigureAwait(false))
                return await next(context).ConfigureAwait(false);

            return Results.NotFound();
        });
}
