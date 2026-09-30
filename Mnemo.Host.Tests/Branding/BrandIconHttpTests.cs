using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Services;
using Mnemo.Host.Branding;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Branding;

/// <summary>
/// The brand icon routes against a real folder. No window can attach in a test host, so the
/// format a window would report is stood in for where a stored file is wanted.
/// </summary>
public sealed class BrandIconHttpTests : IAsyncDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("mnemo-brand-icon").FullName;
    private readonly RecordingShortcuts _shortcuts = new();
    private readonly BrandIconService _icons;
    private readonly WebApplication _app;
    private HttpClient? _client;

    public BrandIconHttpTests()
    {
        _icons = new BrandIconService(Path.Combine(_folder, "brand"), Path.Combine(_folder, "default"), new SilentLogger(), _shortcuts);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton(_icons);

        _app = builder.Build();
        _app.MapBrandIcon();
    }

    private string Brand => Path.Combine(_folder, "brand");

    private async Task<HttpClient> ClientAsync()
    {
        if (_client is null)
        {
            await _app.StartAsync();
            _client = _app.GetTestClient();
        }
        return _client;
    }

    private async Task<HttpResponseMessage> PutAsync(string? key, string? data)
    {
        var client = await ClientAsync();
        return await client.PutAsJsonAsync("/api/app/brand-icon", new { key, data });
    }

    private async Task<(string? Key, string? Format)> GetAsync()
    {
        var client = await ClientAsync();
        using var json = JsonDocument.Parse(await client.GetStringAsync("/api/app/brand-icon"));
        var root = json.RootElement;
        return (root.GetProperty("key").GetString(), root.GetProperty("format").GetString());
    }

    private static async Task<string?> ErrorOf(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("error").GetString();
    }

    [Fact]
    public async Task WithNoWindowTheFormatIsNullAndAnUploadIsRefused()
    {
        Assert.Equal((null, null), await GetAsync());

        var response = await PutAsync("sunset", Convert.ToBase64String(BrandIconFixtures.Ico(256)));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("unsupported", await ErrorOf(response));
        Assert.False(Directory.Exists(Brand));
    }

    [Fact]
    public async Task AStoredIconIsReportedByKeyAndWrittenUnderAContentKeyedName()
    {
        _icons.UseFormat(BrandIconFile.Ico);
        var ico = BrandIconFixtures.Ico(16, 32, 256);

        var response = await PutAsync("accent:teal", Convert.ToBase64String(ico));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(("accent:teal", BrandIconFile.Ico), await GetAsync());
        Assert.Equal(ico, await File.ReadAllBytesAsync(Path.Combine(Brand, "icon-accent_teal.ico")));
        Assert.Equal(["current.json", "icon-accent_teal.ico"], FilesInBrand());
    }

    [Fact]
    public async Task SwitchingIconsRemovesTheOldFileAndTellsTheShortcuts()
    {
        _icons.UseFormat(BrandIconFile.Png256);

        await PutAsync("forest", Convert.ToBase64String(BrandIconFixtures.Png(256, 256)));
        await _icons.ShortcutSyncSettled;
        var response = await PutAsync("nordic", Convert.ToBase64String(BrandIconFixtures.Png(256, 256)));
        await _icons.ShortcutSyncSettled;

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(["current.json", "icon-nordic.png"], FilesInBrand());
        Assert.Equal(Path.Combine(Brand, "icon-nordic.png"), _shortcuts.Applied.Last());
    }

    [Fact]
    public async Task DeleteRemovesEveryStoredIconAndRevertsTheShortcuts()
    {
        _icons.UseFormat(BrandIconFile.Png1024);
        await PutAsync("harbour", Convert.ToBase64String(BrandIconFixtures.Png(1024, 1024)));
        await File.WriteAllBytesAsync(Path.Combine(Brand, "icon-leftover.png"), [1]);

        var client = await ClientAsync();
        var response = await client.DeleteAsync("/api/app/brand-icon");
        await _icons.ShortcutSyncSettled;

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(FilesInBrand());
        Assert.Equal((null, BrandIconFile.Png1024), await GetAsync());
        Assert.Null(_shortcuts.Applied.Last());
    }

    [Fact]
    public async Task ARecordNamingAFileOutsideTheFolderIsIgnored()
    {
        Directory.CreateDirectory(Brand);
        await File.WriteAllTextAsync(Path.Combine(Brand, "current.json"), """{"Key":"sunset","File":"..\\secret.ico"}""");

        Assert.Equal((null, null), await GetAsync());
    }

    [Theory]
    [InlineData("Sunset", "invalid_key")]
    [InlineData("a/b", "invalid_key")]
    [InlineData("", "invalid_key")]
    [InlineData(null, "invalid_key")]
    public async Task ABadKeyIsRefused(string? key, string expected)
    {
        _icons.UseFormat(BrandIconFile.Ico);

        var response = await PutAsync(key, Convert.ToBase64String(BrandIconFixtures.Ico(256)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(expected, await ErrorOf(response));
    }

    [Fact]
    public async Task AKeyOverTheLengthLimitIsRefused()
    {
        _icons.UseFormat(BrandIconFile.Ico);

        var response = await PutAsync(new string('k', BrandIconFile.MaxKeyLength + 1), Convert.ToBase64String(BrandIconFixtures.Ico(256)));

        Assert.Equal("invalid_key", await ErrorOf(response));
    }

    [Fact]
    public async Task DataThatIsNotBase64IsRefused()
    {
        _icons.UseFormat(BrandIconFile.Ico);

        var response = await PutAsync("sunset", "not base64 at all!");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_data", await ErrorOf(response));
    }

    [Fact]
    public async Task AWrongFileIsRefusedAndNothingIsWritten()
    {
        _icons.UseFormat(BrandIconFile.Png256);

        var notPng = await PutAsync("sunset", Convert.ToBase64String(Encoding.ASCII.GetBytes("GIF89a, not a png at all, padded out")));
        var wrongSize = await PutAsync("sunset", Convert.ToBase64String(BrandIconFixtures.Png(512, 512)));
        _icons.UseFormat(BrandIconFile.Ico);
        var no256 = await PutAsync("sunset", Convert.ToBase64String(BrandIconFixtures.Ico(16, 48)));

        Assert.Equal("invalid_png", await ErrorOf(notPng));
        Assert.Equal("wrong_size", await ErrorOf(wrongSize));
        Assert.Equal("missing_256", await ErrorOf(no256));
        Assert.False(Directory.Exists(Brand));
        Assert.Empty(_shortcuts.Applied);
    }

    [Fact]
    public async Task ABodyOverTheCapIsRefusedBeforeItIsRead()
    {
        _icons.UseFormat(BrandIconFile.Ico);

        var body = JsonSerializer.Serialize(new { key = "sunset", data = new string('A', BrandIconService.MaxBodyBytes) });
        var client = await ClientAsync();
        var response = await client.PutAsync("/api/app/brand-icon", new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("too_large", await ErrorOf(response));
    }

    [Fact]
    public async Task ADecodedFileOverTheCapIsRefused()
    {
        _icons.UseFormat(BrandIconFile.Ico);
        var data = Convert.ToBase64String(new byte[BrandIconService.MaxFileBytes + 1]);

        Assert.Equal("too_large", await _icons.StoreAsync("sunset", data, CancellationToken.None));
    }

    private string[] FilesInBrand() =>
        Directory.Exists(Brand)
            ? Directory.GetFiles(Brand).Select(file => Path.GetFileName(file)).Order(StringComparer.Ordinal).ToArray()
            : [];

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        await _app.DisposeAsync();
        await _icons.ShortcutSyncSettled;
        Directory.Delete(_folder, recursive: true);
    }

    private sealed class RecordingShortcuts : IShortcutIconSync
    {
        public List<string?> Applied { get; } = [];

        public Task<int> ApplyAsync(string? iconFile)
        {
            lock (Applied)
                Applied.Add(iconFile);
            return Task.FromResult(1);
        }
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
