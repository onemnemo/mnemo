using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Mnemo.Host.Web;

/// <summary>
/// Security layers for the loopback API. Loopback binding alone does not stop
/// drive-by requests from a browser tab on the same machine, so every request
/// passes a Host-header check (DNS-rebind guard) and API routes additionally
/// require the per-launch bearer token the host templates into the served page.
/// </summary>
public static class LocalApiSecurity
{
    /// <summary>Mints the per-launch bearer token: 256 bits, lowercase hex.</summary>
    public static string MintBearerToken()
        => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));

    /// <summary>
    /// Rejects any request whose Host header is not a loopback name. Runs for
    /// every request, before anything else.
    /// </summary>
    public static IApplicationBuilder UseLoopbackHostGuard(this IApplicationBuilder app)
        => app.Use(async (ctx, next) =>
        {
            var host = ctx.Request.Host.Host;
            if (!string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
                && host != "127.0.0.1")
            {
                ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            await next(ctx).ConfigureAwait(false);
        });

    /// <summary>
    /// Requires <c>Authorization: Bearer &lt;token&gt;</c> on every <c>/api</c> route
    /// except the given exempt paths. Non-API paths (the SPA itself) stay open:
    /// the page is what delivers the token to the client.
    /// </summary>
    public static IApplicationBuilder UseApiBearerToken(
        this IApplicationBuilder app, string bearerToken, params PathString[] exemptPaths)
    {
        var expected = Encoding.UTF8.GetBytes("Bearer " + bearerToken);

        return app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Path.StartsWithSegments("/api") && !IsExempt(ctx.Request.Path, exemptPaths))
            {
                var presented = Encoding.UTF8.GetBytes(ctx.Request.Headers.Authorization.ToString());
                if (!CryptographicOperations.FixedTimeEquals(presented, expected))
                {
                    ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return;
                }
            }

            await next(ctx).ConfigureAwait(false);
        });
    }

    private static bool IsExempt(PathString path, PathString[] exemptPaths)
    {
        foreach (var exempt in exemptPaths)
        {
            if (path == exempt)
                return true;
        }

        return false;
    }
}
