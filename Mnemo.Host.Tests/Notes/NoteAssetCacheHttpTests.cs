using System.Net;
using System.Net.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using LogLevel = Mnemo.Core.Enums.LogLevel;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Notes;
using Mnemo.Host.Tests.Flashcards;
using Mnemo.Host.Tests.Lifecycle;
using Mnemo.Host.Web;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;
using Xunit;

namespace Mnemo.Host.Tests.Notes;

[Collection(DataRootCollection.Name)]
public sealed class NoteAssetCacheHttpTests : IAsyncLifetime
{
    private const string Token = "bearer-token";
    private const string Immutable = "private, max-age=31536000, immutable";
    private const string Revalidate = "private, no-cache";
    private const string ContentName = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png";
    private const string Guid = "0f8fad5bd9cb469fa16570867728950e";

    private readonly FlashcardAssetUploadHttpTests.TemporaryDataRoot _root = new();
    private readonly HostInstanceLock _lock;
    private readonly WebApplication _app;
    private readonly ImageCookie _cookie = ImageCookie.Mint(5200);
    private HttpClient? _client;

    public NoteAssetCacheHttpTests()
    {
        Write(MnemoAppPaths.GetImageAssetsDirectory(), ContentName);
        Write(MnemoAppPaths.GetImageAssetsDirectory(), "plain.png");
        Write(MnemoAppPaths.GetNoteAssetsDirectory(), $"{Guid}.png");
        Write(MnemoAppPaths.GetImagesDirectory(), "legacy.png");

        var logger = new SilentLogger();
        var migrator = new CompleteMigrator();
        _lock = HostInstanceLock.Acquire(Path.Combine(_root.Path, "locks"));

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton<INoteSidMigrator>(migrator);
        builder.Services.AddSingleton(TestImages.Store());
        builder.Services.AddSingleton(new NoteAssets(
            new SqliteStorageProvider(logger, Path.Combine(_root.Path, "mnemo.db")), migrator, new ImageFileLocks(), logger, _lock));

        _app = builder.Build();
        _app.UseApiBearerToken(Token, _cookie);
        _app.MapNoteAssets();
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
        using var response = await GetAsync($"/api/notes/assets/{ContentName}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Immutable, CacheControl(response));
    }

    [Theory]
    [InlineData("/api/notes/assets/plain.png")]
    [InlineData($"/api/notes/assets/{Guid}.png")]
    [InlineData($"/api/notes/assets/{Guid}")]
    public async Task EveryOtherIdShapeRevalidates(string path)
    {
        using var response = await GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Revalidate, CacheControl(response));
        Assert.NotNull(response.Headers.ETag);

        using var again = await GetAsync(path, configure: request => request.Headers.IfNoneMatch.Add(response.Headers.ETag!));
        Assert.Equal(HttpStatusCode.NotModified, again.StatusCode);
    }

    [Fact]
    public async Task ALegacyPathRevalidates()
    {
        var path = "/api/notes/assets/legacy?path=" + Uri.EscapeDataString(Path.Combine(MnemoAppPaths.GetImagesDirectory(), "legacy.png"));
        using var response = await GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Revalidate, CacheControl(response));
        Assert.NotNull(response.Headers.ETag);
        Assert.NotNull(response.Content.Headers.LastModified);

        using var again = await GetAsync(path, bearer: false);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task TheCookieOpensTheImageRoutesAndNothingElseHere()
    {
        using var image = await GetAsync($"/api/notes/assets/{ContentName}", bearer: false);
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);

        using var missing = await GetAsync("/api/notes/assets/nothing.png", bearer: false);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/notes/asset-sessions");
        request.Headers.Add("Cookie", $"{_cookie.Name}={_cookie.Value}");
        using var session = await _client!.SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, session.StatusCode);
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
            _lock.Dispose();
        }
        finally
        {
            _root.Dispose();
        }
    }

    private sealed class CompleteMigrator : INoteSidMigrator
    {
        public bool IsComplete => true;

        public Task MigrateAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
