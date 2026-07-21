using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// The client's half of the shutdown handshake: the window told the SPA it was
/// closing, and this is the SPA saying it has finished saving.
/// </summary>
public static class LifecycleEndpoints
{
    public static void MapLifecycle(this IEndpointRouteBuilder endpoints)
    {
        // Unconditional: the gate only ever waits after it has asked, so an
        // unsolicited call resolves a wait that is not running and does nothing.
        endpoints.MapPost("/api/app/shutdown-ready", (ShutdownGate gate) =>
        {
            gate.SignalReady();
            return Results.NoContent();
        });
    }
}
