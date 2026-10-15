using System.Net;
using System.Net.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Host.Flashcards;
using Mnemo.Host.Tests.Lifecycle;
using Mnemo.Host.Web;
using Mnemo.Infrastructure.Common;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

[Collection(DataRootCollection.Name)]
public sealed class CardAssetCacheHttpTests : IAsyncLifetime
{
    private const string Token = "bearer-token";
    private const string Immutable = "private, max-age=31536000, immutable";
    private const string Revalidate = "private, no-cache";
    private const string ContentName = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png";

    private readonly FlashcardAssetUploadHttpTests.TemporaryDataRoot _root = new();
    private readonly WebApplication _app;
    private readonly ImageCookie _cookie = ImageCookie.Mint(5201);
    private HttpClient? _client;

    public CardAssetCacheHttpTests()
    {
        Write(MnemoAppPaths.GetImageAssetsDirectory(), ContentName);
        Write(MnemoAppPaths.GetImageAssetsDirectory(), "plain.png");
        Write(MnemoAppPaths.GetImagesDirectory(), "legacy.png");

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton(TestImages.Store());

        _app = builder.Build();
        _app.UseApiBearerToken(Token, _cookie);
        _app.MapFlashcardAssets();
    }

    private static void Write(string directory, string name)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllBytes(Path.Combine(directory, name), [1, 2, 3]);
    }

    private async Task<HttpResponseMessage> GetAsync(string path, bool bearer = true, Action<HttpRequestMessage>? configure = null)
    {
        if (_client is null)
        {
            await _app.StartAsync();
            _client = _app.GetTestClient();
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (bearer)
            request.Headers.Authorization = new("Bearer", Token);
        else
            request.Headers.Add("Cookie", $"{_cookie.Name}={_cookie.Value}");
        configure?.Invoke(request);
        return await _client.SendAsync(request);
    }

    private static string CacheControl(HttpResponseMessage response) =>
        response.Headers.NonValidated["Cache-Control"].ToString();

    [Fact]
    public async Task AContentNameInTheSharedStoreIsCachedForGood()
    {
        using var response = await GetAsync($"/api/flashcards/assets/{ContentName}", bearer: false);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Immutable, CacheControl(response));
    }

    [Theory]
    [InlineData("/api/flashcards/assets/plain.png")]
    [InlineData("/api/flashcards/assets/legacy.png")]
    public async Task EveryOtherNameRevalidates(string path)
    {
        using var response = await GetAsync(path, bearer: false);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Revalidate, CacheControl(response));
        Assert.NotNull(response.Headers.ETag);

        using var again = await GetAsync(path, configure: request => request.Headers.IfNoneMatch.Add(response.Headers.ETag!));
        Assert.Equal(HttpStatusCode.NotModified, again.StatusCode);
    }

    [Fact]
    public async Task AMissingImageIsNotFound()
    {
        using var response = await GetAsync("/api/flashcards/assets/nothing.png", bearer: false);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task TheCookieDoesNotOpenUploads()
    {
        await GetAsync("/api/flashcards/assets/plain.png", bearer: false);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/flashcards/assets");
        request.Headers.Add("Cookie", $"{_cookie.Name}={_cookie.Value}");
        using var response = await _client!.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ACrossSiteRequestWithTheCookieIsRefused()
    {
        using var response = await GetAsync(
            "/api/flashcards/assets/plain.png", bearer: false, configure: request => request.Headers.Add("Sec-Fetch-Site", "cross-site"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        try
        {
            _client?.Dispose();
            if (_client is not null)
                await _app.StopAsync();
            await _app.DisposeAsync();
        }
        finally
        {
            _root.Dispose();
        }
    }
}
