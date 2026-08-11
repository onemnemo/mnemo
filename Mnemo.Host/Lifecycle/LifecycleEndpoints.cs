using System;
using System.Diagnostics;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// The client's half of the shutdown handshake: the window told the SPA it was
/// closing, and this is the SPA saying it has finished saving. Plus the one other
/// thing only the host can do on the SPA's behalf: leave the window.
/// </summary>
public static class LifecycleEndpoints
{
    /// <param name="Url">An absolute http or https URL. Anything else is refused.</param>
    public sealed record OpenExternalRequest(string Url);

    public static void MapLifecycle(this IEndpointRouteBuilder endpoints)
    {
        // Unconditional: the gate only ever waits after it has asked, so an
        // unsolicited call resolves a wait that is not running and does nothing.
        endpoints.MapPost("/api/app/shutdown-ready", (ShutdownGate gate) =>
        {
            gate.SignalReady();
            return Results.NoContent();
        });

        // Hands a link to the operating system's default browser.
        //
        // The SPA cannot do this itself. The window is chromeless and has no tabs, so a
        // navigation would replace the application with a web page and leave no way back,
        // and PhotinoX exposes no new-window hook to intercept `window.open` with.
        //
        // The scheme allowlist is the whole security boundary here: UseShellExecute hands
        // the string to the shell, which would happily launch a `file:` path or a
        // registered protocol handler. Only the two schemes a link in this UI can
        // legitimately carry get through.
        endpoints.MapPost("/api/app/open-external", (OpenExternalRequest body) =>
        {
            if (!Uri.TryCreate(body.Url, UriKind.Absolute, out var uri))
                return Results.BadRequest(new { error = "invalid_url" });

            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
                return Results.BadRequest(new { error = "unsupported_scheme" });

            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception)
            {
                // No browser, or the shell refused. Nothing to recover, but the caller
                // should hear about it rather than watch a button do nothing.
                return Results.Problem("Could not open the link.", statusCode: StatusCodes.Status502BadGateway);
            }

            return Results.NoContent();
        });
    }
}
