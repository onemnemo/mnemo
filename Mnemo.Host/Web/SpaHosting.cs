using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Web;

/// <summary>
/// Serves the built SPA. The page itself is never served straight from disk:
/// index.html is templated once at startup with the per-launch bearer token
/// (PhotinoX has no init-script injection, so the served page is the only channel
/// that can hand the token to the browser before the bundle runs).
/// </summary>
public static class SpaHosting
{
    public static string LoadTemplatedIndex(string spaRoot, string bearerToken)
    {
        var indexPath = Path.Combine(spaRoot, "index.html");
        if (!File.Exists(indexPath))
        {
            throw new InvalidOperationException(
                $"SPA index.html not found at '{indexPath}'. Build mnemo-web (npm run build) or point MNEMO_SPA_ROOT at its dist folder.");
        }

        var html = File.ReadAllText(indexPath);
        const string marker = "</head>";
        var insertAt = html.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (insertAt < 0)
        {
            throw new InvalidOperationException($"'{indexPath}' has no </head> tag to template the auth token into.");
        }

        // The token is lowercase hex, so it needs no HTML or JS escaping.
        return html.Insert(insertAt, $"<script>window.__MNEMO_TOKEN__ = \"{bearerToken}\";</script>");
    }

    public static void MapSpa(WebApplication app, string spaRoot, string templatedIndexHtml)
    {
        // Intercept the page itself (including direct /index.html requests) so the
        // untemplated file on disk is never served.
        app.Use(async (ctx, next) =>
        {
            if (HttpMethods.IsGet(ctx.Request.Method)
                && (ctx.Request.Path == "/" || ctx.Request.Path == "/index.html"))
            {
                await WriteIndexAsync(ctx, templatedIndexHtml).ConfigureAwait(false);
                return;
            }

            await next(ctx).ConfigureAwait(false);
        });

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(spaRoot),
        });

        app.MapFallback(async ctx =>
        {
            if (ctx.Request.Path.StartsWithSegments("/api"))
            {
                ctx.Response.StatusCode = StatusCodes.Status404NotFound;
                await ctx.Response.WriteAsJsonAsync(new ErrorDto("not_found", "Unknown API route.")).ConfigureAwait(false);
                return;
            }

            await WriteIndexAsync(ctx, templatedIndexHtml).ConfigureAwait(false);
        });
    }

    private static Task WriteIndexAsync(HttpContext ctx, string html)
    {
        ctx.Response.ContentType = "text/html; charset=utf-8";
        // The token changes every launch; a cached page would carry a dead one.
        ctx.Response.Headers.CacheControl = "no-store";
        return ctx.Response.WriteAsync(html);
    }
}
