using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Updates;

/// <summary>
/// The SPA's view of the updater: what state it is in, and the three things a user can
/// ask of it.
/// </summary>
/// <remarks>
/// Every route answers with the whole <see cref="UpdateStatus"/> rather than an
/// acknowledgement, so a client that has just started and one that has been listening
/// all along end up with the same object. The long-running halves (download, apply) do
/// not hold their request open; they answer 202 and report through the event stream.
/// </remarks>
public static class UpdateEndpoints
{
    /// <param name="Automatic">
    /// True for the check the app runs at startup, which is allowed to decline: it obeys
    /// the auto-check setting and the cooldown. A check the user asked for never declines.
    /// </param>
    public sealed record CheckRequest(bool Automatic);

    public static void MapUpdates(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/updates/state", async (UpdateCoordinator coordinator, CancellationToken ct) =>
            await coordinator.GetStatusAsync(ct).ConfigureAwait(false));

        endpoints.MapPost("/api/updates/check", async (CheckRequest? body, UpdateCoordinator coordinator, CancellationToken ct) =>
            await coordinator.CheckAsync(body?.Automatic ?? false, ct).ConfigureAwait(false));

        endpoints.MapPost("/api/updates/download", async (UpdateCoordinator coordinator, CancellationToken ct) =>
        {
            var status = await coordinator.GetStatusAsync(ct).ConfigureAwait(false);

            // A portable or unpackaged build has no Velopack layout to write into. The
            // SPA hides the button in that case, so this is the belt to that braces:
            // without it the download would fail deep in the service and surface as a
            // generic error rather than "this build updates by hand".
            if (!status.SupportsInAppApply)
                return Results.Json(
                    new ErrorDto("unsupported", "This build cannot install updates in place."),
                    statusCode: StatusCodes.Status409Conflict);

            if (status.AvailableVersion is null)
                return Results.Json(
                    new ErrorDto("nothing_to_download", "No update has been found to download."),
                    statusCode: StatusCodes.Status409Conflict);

            var started = await coordinator.BeginDownloadAsync(ct).ConfigureAwait(false);
            return Results.Accepted(value: started);
        });

        endpoints.MapPost("/api/updates/apply", (UpdateCoordinator coordinator) =>
        {
            if (!coordinator.CanApply)
                return Results.Json(
                    new ErrorDto("not_ready", "No downloaded update is waiting to be applied."),
                    statusCode: StatusCodes.Status409Conflict);

            // Answered before it happens, because applying replaces this process: awaiting
            // the call would mean the response never leaves. The client has already flushed
            // its own work before asking, and the short delay is only there to let this
            // response reach it.
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromMilliseconds(500)).ConfigureAwait(false);
                coordinator.Apply();
            });

            return Results.Accepted();
        });
    }
}
