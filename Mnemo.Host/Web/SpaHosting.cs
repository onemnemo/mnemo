using System.Security.Cryptography;

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
    public static SpaDocument LoadTemplatedIndex(string spaRoot, string bearerToken)
    {
        var indexPath = Path.Combine(spaRoot, "index.html");
        if (!File.Exists(indexPath))
        {
            throw new InvalidOperationException(
                $"SPA index.html not found at '{indexPath}'. Build mnemo-web (npm run build) or point MNEMO_SPA_ROOT at its dist folder.");
        }

        var html = File.ReadAllText(indexPath);

        // Every inline script in the page has to carry the nonce or the policy stops it.
        // There are two: the first-paint theme hint the build leaves in the page, and the
        // token below. A script with a src is covered by 'self' and needs nothing, which is
        // why matching the bare opening tag is enough and does not touch the bundle's.
        var nonce = CreateNonce();
        html = html.Replace("<script>", $"<script nonce=\"{nonce}\">", StringComparison.Ordinal);

        const string marker = "</head>";
        var insertAt = html.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (insertAt < 0)
        {
            throw new InvalidOperationException($"'{indexPath}' has no </head> tag to template the auth token into.");
        }

        // The token is lowercase hex, so it needs no HTML or JS escaping.
        var templated = html.Insert(
            insertAt,
            $"<script nonce=\"{nonce}\">window.__MNEMO_TOKEN__ = \"{bearerToken}\";</script>");

        return new SpaDocument(templated, BuildPolicy(nonce));
    }

    /// <summary>
    /// A fresh nonce for this launch.
    /// </summary>
    /// <remarks>
    /// Per launch rather than per response, because the page is templated once at startup
    /// and handed out unchanged after that. That is the same lifetime the bearer token
    /// already has, and the page is only ever served to this app's own window.
    /// </remarks>
    private static string CreateNonce() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));

    /// <summary>
    /// The policy the page is served under.
    /// </summary>
    /// <remarks>
    /// Scripts are the point of it. The chat renderer puts model output on the page, so a
    /// nonce that output cannot know is what keeps any script arriving that way from
    /// running, whatever route it took to get there.
    ///
    /// Styles keep unsafe-inline: components and editor libraries add style elements at
    /// runtime, and an injected stylesheet is a much smaller problem than an injected
    /// script. blob: is in img-src because note assets, mindmap images and raster export
    /// are all read back through object URLs, and data: because icons are inlined.
    ///
    /// worker-src is spelled out rather than left to fall back to default-src, because the
    /// PDF preview starts one and the fallback chain is not the place to find that out. It
    /// stays at 'self' because the worker is bundled as an asset: pdf.js wraps a worker it
    /// considers cross-origin in a blob, and that path is what shipping it locally avoids.
    /// </remarks>
    private static string BuildPolicy(string nonce) => string.Join("; ",
        "default-src 'self'",
        $"script-src 'self' 'nonce-{nonce}'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' blob:",
        "worker-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'");

    public static void MapSpa(WebApplication app, string spaRoot, SpaDocument document)
    {
        // Intercept the page itself (including direct /index.html requests) so the
        // untemplated file on disk is never served.
        app.Use(async (ctx, next) =>
        {
            if (HttpMethods.IsGet(ctx.Request.Method)
                && (ctx.Request.Path == "/" || ctx.Request.Path == "/index.html"))
            {
                await WriteIndexAsync(ctx, document).ConfigureAwait(false);
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

            await WriteIndexAsync(ctx, document).ConfigureAwait(false);
        });
    }

    private static Task WriteIndexAsync(HttpContext ctx, SpaDocument document)
    {
        ctx.Response.ContentType = "text/html; charset=utf-8";
        // The token changes every launch; a cached page would carry a dead one.
        ctx.Response.Headers.CacheControl = "no-store";
        // On the document and not the assets beside it: a policy is what a page is read
        // under, and it does nothing on the script and stylesheet responses themselves.
        ctx.Response.Headers.ContentSecurityPolicy = document.ContentSecurityPolicy;
        return ctx.Response.WriteAsync(document.Html);
    }
}
