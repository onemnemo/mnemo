using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Logging;
using Mnemo.Host.Contracts;
using Mnemo.Host.Flashcards;
using Mnemo.Host.Tests.Lifecycle;
using Mnemo.Infrastructure.Common;
using Xunit;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The card attachment upload route. It runs three checks before it ever touches disk (form
/// shape, size, extension) and a fourth once the bytes are in hand: the file has to actually be
/// the image type its extension claims, the same signature sniff every other asset store in the
/// host applies. This needs its own data root, so it shares <see cref="DataRootCollection"/> with
/// <c>OpenFolderTests</c> rather than racing it.
/// </summary>
[Collection(DataRootCollection.Name)]
public sealed class FlashcardAssetUploadHttpTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task ANonMultipartBodyIsRefusedAsAnInvalidUpload()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.PostAsync("/api/flashcards/assets", new StringContent("not a form"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_upload", await ErrorCode(response));
    }

    [Fact]
    public async Task ABrokenMultipartBodyIsAnInvalidUploadNotAnOversizeOne()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var body = new StringContent("--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\n\r\nPNG", System.Text.Encoding.ASCII);
        body.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse("multipart/form-data; boundary=b");

        var response = await h.Client.PostAsync("/api/flashcards/assets", body);

        Assert.NotEqual(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("invalid_upload", await ErrorCode(response));
    }

    [Fact]
    public async Task AFormWithNoFileIsAnEmptyUpload()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("not a file"), "note");

        var response = await h.Client.PostAsync("/api/flashcards/assets", form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("empty_upload", await ErrorCode(response));
    }

    [Fact]
    public async Task AZeroLengthFileIsAnEmptyUpload()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await Upload(h, "empty.png", "image/png", []);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("empty_upload", await ErrorCode(response));
    }

    [Fact]
    public async Task ADisallowedExtensionIsAnUnsupportedImage()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await Upload(h, "notes.txt", "text/plain", [1, 2, 3, 4]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("unsupported_image", await ErrorCode(response));
    }

    [Fact]
    public async Task BytesThatDoNotMatchTheClaimedExtensionAreAnUnsupportedImage()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        // A jpeg header wearing a .png name: the extension alone would pass, the signature will not.
        byte[] jpegHeader = [0xFF, 0xD8, 0xFF, 0xE1, 0, 0, 0, 0, 0, 0, 0, 0];

        var response = await Upload(h, "disguised.png", "image/png", jpegHeader);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("unsupported_image", await ErrorCode(response));
        Assert.Empty(Directory.Exists(FlashcardAssetStore.Directory) ? Directory.GetFiles(FlashcardAssetStore.Directory) : []);
    }

    [Fact]
    public async Task AFileOverTheLimitIsRefusedWithTheFriendlyError()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        var oversize = new byte[(int)FlashcardAssetStore.MaxFileBytes + 1];

        var response = await Upload(h, "scan.png", "image/png", oversize);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("file_too_large", await ErrorCode(response));
    }

    [Fact]
    public async Task TheRequestBodyCapSitsJustAboveTheFileLimitSoAnOversizeFileReachesTheHandler()
    {
        var feature = new RecordingBodySizeFeature();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        await using var app = builder.Build();
        app.Use((context, next) =>
        {
            context.Features.Set<IHttpMaxRequestBodySizeFeature>(feature);
            return next(context);
        });
        app.MapFlashcardAssets();
        await app.StartAsync();

        await app.GetTestClient().PostAsync("/api/flashcards/assets", new StringContent("not a form"));

        Assert.True(feature.MaxRequestBodySize > FlashcardAssetStore.MaxFileBytes);
        Assert.True(feature.MaxRequestBodySize < 30_000_000, "Kestrel's own default cap is 30 MB; the endpoint sets its own.");
        await app.StopAsync();
    }

    [Fact]
    public async Task AGenuinePngRoundTripsAndIsServedBackByItsAssetId()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

        var response = await Upload(h, "diagram.png", "image/png", png);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var asset = JsonSerializer.Deserialize<CardAssetDto>(await response.Content.ReadAsStringAsync(), Json)!;
        Assert.Equal("diagram.png", asset.DisplayName);
        Assert.Equal(png.Length, asset.SizeBytes);

        var served = await h.Client.GetAsync($"/api/flashcards/assets/{asset.AssetId}");
        Assert.Equal(HttpStatusCode.OK, served.StatusCode);
        Assert.Equal(png, await served.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task AnUnknownAssetIdIsA404()
    {
        using var root = new TemporaryDataRoot();
        await using var h = new FlashcardHttpHarness();
        await h.StartAsync();

        var response = await h.Client.GetAsync("/api/flashcards/assets/does-not-exist.png");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private sealed class RecordingBodySizeFeature : IHttpMaxRequestBodySizeFeature
    {
        public bool IsReadOnly => false;

        public long? MaxRequestBodySize { get; set; } = 30_000_000;
    }

    private static async Task<HttpResponseMessage> Upload(FlashcardHttpHarness h, string fileName, string contentType, byte[] bytes)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(fileContent, "file", fileName);
        return await h.Client.PostAsync("/api/flashcards/assets", form);
    }

    private static async Task<string> ErrorCode(HttpResponseMessage response) =>
        JsonSerializer.Deserialize<ErrorDto>(await response.Content.ReadAsStringAsync(), Json)!.Error;

    /// <summary>
    /// Points the app's data root, and so the flashcard images directory, at a scratch
    /// directory for the test's lifetime. Same shape as <c>OpenFolderTests</c>' own helper;
    /// duplicated rather than shared because that one is private to its file.
    /// </summary>
    private sealed class TemporaryDataRoot : IDisposable
    {
        private readonly string? _previous;

        public TemporaryDataRoot()
        {
            Path = System.IO.Path.GetFullPath(
                System.IO.Path.Combine(System.IO.Path.GetTempPath(), "mnemo-fc-assets-" + Guid.NewGuid().ToString("n")));
            Directory.CreateDirectory(Path);

            _previous = Environment.GetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable);
            Environment.SetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable, Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            Environment.SetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable, _previous);
            try
            {
                Directory.Delete(Path, recursive: true);
            }
            catch (IOException)
            {
                // A leftover temp directory is not worth failing a green test over.
            }
        }
    }
}
