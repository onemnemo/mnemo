using System;
using System.IO;
using System.Text.RegularExpressions;
using Mnemo.Host.Web;
using Xunit;

namespace Mnemo.Host.Tests.Web;

/// <summary>
/// Templating the served page, and the policy that comes with it.
/// </summary>
/// <remarks>
/// The nonce and the page are only correct together. A nonce the policy names but the page
/// does not carry blocks the app's own startup script, which takes the whole window down,
/// and it does so only in a packaged build because dev mode never serves this page.
/// </remarks>
public sealed class SpaHostingTests
{
    /// <summary>
    /// Mirrors what the build actually emits: one inline script for the first-paint theme
    /// hint, and the bundle referenced by src.
    /// </summary>
    private const string BuiltIndexHtml = """
        <!doctype html>
        <html lang="en" data-theme="light">
          <head>
            <meta charset="UTF-8" />
            <title>mnemo-web</title>
            <script>
              (function () { document.documentElement.setAttribute("data-theme", "dark"); })();
            </script>
            <script type="module" crossorigin src="/assets/index-BBdDdkQJ.js"></script>
            <link rel="stylesheet" crossorigin href="/assets/index-UTj4h6MK.css">
          </head>
          <body><div id="root"></div></body>
        </html>
        """;

    [Fact]
    public void Every_inline_script_carries_the_nonce_the_policy_names()
    {
        var document = Load(BuiltIndexHtml);
        var nonce = NonceFrom(document.ContentSecurityPolicy);

        // The theme hint and the token script. Either one left bare is a script the
        // packaged app blocks itself from running.
        Assert.Equal(2, Regex.Matches(document.Html, $"<script nonce=\"{Regex.Escape(nonce)}\">").Count);
        Assert.DoesNotContain("<script>", document.Html, StringComparison.Ordinal);
    }

    [Fact]
    public void The_bundle_is_left_alone_because_same_origin_already_covers_it()
    {
        var document = Load(BuiltIndexHtml);

        Assert.Contains(
            "<script type=\"module\" crossorigin src=\"/assets/index-BBdDdkQJ.js\">",
            document.Html,
            StringComparison.Ordinal);
    }

    [Fact]
    public void The_token_still_reaches_the_page()
    {
        var document = Load(BuiltIndexHtml, bearerToken: "abc123");

        Assert.Contains("window.__MNEMO_TOKEN__ = \"abc123\"", document.Html, StringComparison.Ordinal);
    }

    [Fact]
    public void The_engine_the_host_built_for_reaches_the_page()
    {
        var document = Load(BuiltIndexHtml);

        // The notes stylesheet gates its content-visibility optimisation on this:
        // Chromium under WebView2 on Windows, WebKit (WebKitGTK / WKWebView) elsewhere.
        var expected = OperatingSystem.IsWindows() ? "chromium" : "webkit";
        Assert.Contains($"window.__MNEMO_ENGINE__ = \"{expected}\"", document.Html, StringComparison.Ordinal);
    }

    [Fact]
    public void The_policy_shuts_the_doors_nothing_in_the_app_uses()
    {
        var policy = Load(BuiltIndexHtml).ContentSecurityPolicy;

        Assert.Contains("default-src 'self'", policy, StringComparison.Ordinal);
        Assert.Contains("object-src 'none'", policy, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", policy, StringComparison.Ordinal);
        Assert.Contains("base-uri 'self'", policy, StringComparison.Ordinal);
    }

    [Fact]
    public void The_policy_still_allows_what_the_app_does_use()
    {
        var policy = Load(BuiltIndexHtml).ContentSecurityPolicy;

        // Object URLs back note assets, mindmap images and raster export.
        Assert.Contains("img-src 'self' data: blob:", policy, StringComparison.Ordinal);
        // Editor and component libraries add style elements while running.
        Assert.Contains("style-src 'self' 'unsafe-inline'", policy, StringComparison.Ordinal);
        // The PDF preview starts a worker, bundled as a same-origin asset.
        Assert.Contains("worker-src 'self'", policy, StringComparison.Ordinal);
        // Fonts are served from the app, so nothing remote needs allowing.
        Assert.Contains("font-src 'self' data:", policy, StringComparison.Ordinal);
    }

    [Fact]
    public void A_second_launch_gets_a_different_nonce()
    {
        var first = NonceFrom(Load(BuiltIndexHtml).ContentSecurityPolicy);
        var second = NonceFrom(Load(BuiltIndexHtml).ContentSecurityPolicy);

        Assert.NotEqual(first, second);
    }

    [Fact]
    public void A_missing_index_says_what_to_do_about_it()
    {
        var root = Path.Combine(Path.GetTempPath(), $"mnemo_spa_{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var error = Assert.Throws<InvalidOperationException>(
                () => SpaHosting.LoadTemplatedIndex(root, "token"));

            Assert.Contains("npm run build", error.Message, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static SpaDocument Load(string html, string bearerToken = "deadbeef")
    {
        var root = Path.Combine(Path.GetTempPath(), $"mnemo_spa_{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(Path.Combine(root, "index.html"), html);
            return SpaHosting.LoadTemplatedIndex(root, bearerToken);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static string NonceFrom(string policy)
    {
        var match = Regex.Match(policy, @"'nonce-([^']+)'");
        Assert.True(match.Success, $"No nonce in the policy: {policy}");
        return match.Groups[1].Value;
    }
}
