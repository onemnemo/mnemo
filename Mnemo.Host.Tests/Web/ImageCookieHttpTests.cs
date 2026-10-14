using System.Net;
using System.Net.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Logging;
using Mnemo.Host.Assets;
using Mnemo.Host.Web;
using Xunit;

namespace Mnemo.Host.Tests.Web;

public sealed class ImageCookieHttpTests : IAsyncLifetime
{
    private const string Token = "bearer-token";
    private const string ContentName = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png";

    private readonly string _folder = Directory.CreateTempSubdirectory("mnemo-image-cookie").FullName;
    private readonly List<WebApplication> _apps = [];

    public ImageCookieHttpTests()
    {
        File.WriteAllText(Path.Combine(_folder, "index.html"), "<html><head></head><body></body></html>");
        File.WriteAllBytes(Path.Combine(_folder, "picture.png"), [1, 2, 3]);
    }

    private async Task<(HttpClient Client, ImageCookie Cookie)> StartAsync(int port = 5100)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        var app = builder.Build();
        _apps.Add(app);

        var cookie = ImageCookie.Mint(port);
        var picture = Path.Combine(_folder, "picture.png");
        app.UseApiBearerToken(Token, cookie);
        app.MapGet("/api/notes/assets/{assetId}", (string assetId, HttpResponse response) =>
            assetId == ContentName ? ImageFileResults.Immutable(response, picture) : ImageFileResults.Revalidated(response, picture))
            .AllowImageCookie();
        // Wins the match over the image route and is not marked.
        app.MapGet("/api/notes/assets/info", () => Results.Ok());
        app.MapPost("/api/notes/assets", () => Results.Ok());
        app.MapGet("/api/settings", () => Results.Ok());
        SpaHosting.MapSpa(app, _folder, SpaHosting.LoadTemplatedIndex(_folder, Token), cookie);

        await app.StartAsync();
        return (app.GetTestClient(), cookie);
    }

    private static async Task<string> CookieFromPageAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/");
        Assert.True(page.Headers.TryGetValues("Set-Cookie", out var values));
        return values.Single().Split(';')[0];
    }

    private static async Task<HttpStatusCode> SendAsync(
        HttpClient client, HttpMethod method, string path, string? cookie, string? fetchSite = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (cookie is not null) request.Headers.Add("Cookie", cookie);
        if (fetchSite is not null) request.Headers.Add("Sec-Fetch-Site", fetchSite);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static string RawCacheControl(HttpResponseMessage response) =>
        response.Headers.NonValidated["Cache-Control"].ToString();

    [Fact]
    public async Task ThePageSetsAPortNamedCookieScopedToTheApi()
    {
        var (client, cookie) = await StartAsync(port: 5123);

        using var page = await client.GetAsync("/");
        var header = Assert.Single(page.Headers.GetValues("Set-Cookie")).ToLowerInvariant();

        Assert.StartsWith($"mnemo_img_5123={cookie.Value}", header, StringComparison.Ordinal);
        Assert.Contains("path=/api", header, StringComparison.Ordinal);
        Assert.Contains("httponly", header, StringComparison.Ordinal);
        Assert.Contains("samesite=strict", header, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheCookieAloneLoadsAnImage()
    {
        var (client, _) = await StartAsync();
        var cookie = await CookieFromPageAsync(client);

        Assert.Equal(HttpStatusCode.OK, await SendAsync(client, HttpMethod.Get, "/api/notes/assets/picture.png", cookie));
        Assert.Equal(HttpStatusCode.OK, await SendAsync(client, HttpMethod.Get, "/api/notes/assets/legacy?path=x", cookie, "same-origin"));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Get, "/api/notes/assets/picture.png", null));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Get, "/api/notes/assets/picture.png", cookie[..^1] + "x"));
    }

    [Fact]
    public async Task TheCookieOpensNoWritesAndNoOtherRoutes()
    {
        var (client, _) = await StartAsync();
        var cookie = await CookieFromPageAsync(client);

        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Post, "/api/notes/assets", cookie));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Post, "/api/notes/assets/picture.png", cookie));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Get, "/api/settings", cookie));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Head, "/api/notes/assets/picture.png", cookie));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Get, "/api/notes/asset-sessions/x", cookie));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Get, "/api/notes/assets/info", cookie));
    }

    [Theory]
    [InlineData("/api/notes/assets/a/b", HttpStatusCode.Unauthorized)]
    [InlineData("/api/notes/assets/%2e%2e", HttpStatusCode.Unauthorized)]
    [InlineData("/api/notes/assets/%2e%2e/%2e%2e/settings", HttpStatusCode.Unauthorized)]
    [InlineData("/API/NOTES/ASSETS/INFO", HttpStatusCode.Unauthorized)]
    [InlineData("/api/notes/assets/a%2Fb", HttpStatusCode.OK)]
    [InlineData("/API/NOTES/ASSETS/picture.png", HttpStatusCode.OK)]
    [InlineData("/api/notes/assets/picture.png/", HttpStatusCode.OK)]
    public async Task TheCookieFollowsTheMatchedEndpointNotThePath(string path, HttpStatusCode expected)
    {
        var (client, _) = await StartAsync();
        var cookie = await CookieFromPageAsync(client);

        Assert.Equal(expected, await SendAsync(client, HttpMethod.Get, path, cookie));
    }

    [Theory]
    [InlineData("cross-site")]
    [InlineData("same-site")]
    [InlineData("none")]
    public async Task ARequestTheBrowserMarksAsForeignIsRefused(string fetchSite)
    {
        var (client, _) = await StartAsync();
        var cookie = await CookieFromPageAsync(client);

        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(client, HttpMethod.Get, "/api/notes/assets/picture.png", cookie, fetchSite));
    }

    [Fact]
    public async Task TwoInstancesKeepTwoCookies()
    {
        var (first, firstCookie) = await StartAsync(port: 5101);
        var (second, secondCookie) = await StartAsync(port: 5102);

        Assert.NotEqual(firstCookie.Name, secondCookie.Name);
        var fromFirst = await CookieFromPageAsync(first);
        Assert.Equal(HttpStatusCode.OK, await SendAsync(first, HttpMethod.Get, "/api/notes/assets/picture.png", fromFirst));
        Assert.Equal(HttpStatusCode.Unauthorized, await SendAsync(second, HttpMethod.Get, "/api/notes/assets/picture.png", fromFirst));
    }

    [Fact]
    public async Task OnlyAContentNameIsCachedForGood()
    {
        var (client, _) = await StartAsync();
        client.DefaultRequestHeaders.Authorization = new("Bearer", Token);

        using var hashed = await client.GetAsync($"/api/notes/assets/{ContentName}");
        Assert.Equal("private, max-age=31536000, immutable", RawCacheControl(hashed));

        using var legacy = await client.GetAsync("/api/notes/assets/picture.png");
        Assert.Equal("private, no-cache", RawCacheControl(legacy));
        Assert.NotNull(legacy.Headers.ETag);
        Assert.NotNull(legacy.Content.Headers.LastModified);

        using var again = new HttpRequestMessage(HttpMethod.Get, "/api/notes/assets/picture.png");
        again.Headers.IfNoneMatch.Add(legacy.Headers.ETag!);
        using var revalidated = await client.SendAsync(again);
        Assert.Equal(HttpStatusCode.NotModified, revalidated.StatusCode);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var app in _apps)
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }

        Directory.Delete(_folder, recursive: true);
    }
}
