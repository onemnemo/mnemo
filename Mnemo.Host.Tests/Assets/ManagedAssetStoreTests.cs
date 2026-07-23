using Mnemo.Host.Assets;
using Xunit;

namespace Mnemo.Host.Tests.Assets;

public sealed class ManagedAssetStoreTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), "mnemo-host-tests", Guid.NewGuid().ToString("N"));

    private ManagedAssetStore ImageStore() => new(() => _directory, ManagedAssetStore.ImageExtensions);
    private ManagedAssetStore AnyStore() => new(() => _directory);

    public void Dispose()
    {
        if (Directory.Exists(_directory))
            Directory.Delete(_directory, recursive: true);
    }

    [Theory]
    [InlineData("abc123.png", true)]
    [InlineData("abc123.PNG", true)]
    [InlineData("abc123.webp", true)]
    [InlineData("abc123.txt", false)]
    [InlineData("abc123", false)]
    [InlineData("", false)]
    [InlineData("  ", false)]
    [InlineData("../abc.png", false)]
    [InlineData("..\\abc.png", false)]
    [InlineData("a/b.png", false)]
    [InlineData("a\\b.png", false)]
    [InlineData("abc..png", false)]
    [InlineData("abc.png.uploading", false)]
    public void ValidatesImageAssetIds(string assetId, bool expected)
    {
        Assert.Equal(expected, ImageStore().IsValidAssetId(assetId));
    }

    [Fact]
    public void UnrestrictedStoreAcceptsAnyExtensionButNeverTraversal()
    {
        var store = AnyStore();
        Assert.True(store.IsValidAssetId("abc123.pdf"));
        Assert.True(store.IsValidAssetId("abc123"));
        Assert.False(store.IsValidAssetId("../abc123.pdf"));
        Assert.False(store.IsValidAssetId("abc123.uploading"));
    }

    [Fact]
    public void MintsIdsCarryingTheExtension()
    {
        var id = ImageStore().GenerateAssetId(".PNG");
        Assert.EndsWith(".png", id, StringComparison.Ordinal);
        Assert.True(ImageStore().IsValidAssetId(id));
    }

    [Fact]
    public void RefusesToMintADisallowedExtension()
    {
        Assert.Throws<ArgumentException>(() => ImageStore().GenerateAssetId(".txt"));
    }

    [Theory]
    [InlineData("photo.PNG", ".png")]
    [InlineData("archive.tar.gz", ".gz")]
    [InlineData("no-extension", "")]
    [InlineData("weird.<>|", "")]
    [InlineData(null, "")]
    public void SanitizesExtensions(string? fileName, string expected)
    {
        Assert.Equal(expected, ManagedAssetStore.SanitizeExtension(fileName));
    }

    [Fact]
    public void MapsContentTypes()
    {
        Assert.Equal("image/png", ManagedAssetStore.ContentTypeForExtension(".png"));
        Assert.Equal("image/webp", ManagedAssetStore.ContentTypeForExtension(".WEBP"));
        Assert.Equal("application/octet-stream", ManagedAssetStore.ContentTypeForExtension(".xyz"));
        Assert.Equal("application/octet-stream", ManagedAssetStore.ContentTypeForExtension(null));
    }

    [Fact]
    public void ResolvesOnlyValidIdsToPaths()
    {
        var store = ImageStore();
        Assert.Equal(Path.Combine(_directory, "a.png"), store.ResolvePath("a.png"));
        Assert.Null(store.ResolvePath("../a.png"));
    }

    [Fact]
    public async Task SaveWritesAtomicallyAndLeavesNoTemp()
    {
        var store = ImageStore();
        var id = store.GenerateAssetId(".png");
        using var content = new MemoryStream(PngBytes());

        var path = await store.SaveAsync(content, id);

        Assert.True(File.Exists(path));
        Assert.Equal(PngBytes(), await File.ReadAllBytesAsync(path));
        Assert.Empty(Directory.GetFiles(_directory, "*" + ManagedAssetStore.PendingUploadSuffix));
    }

    [Fact]
    public async Task SaveRejectsBytesThatDoNotMatchTheClaimedType()
    {
        var store = ImageStore();
        var id = store.GenerateAssetId(".png");
        using var content = new MemoryStream([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 7, 8]);

        await Assert.ThrowsAsync<InvalidDataException>(() => store.SaveAsync(content, id));

        Assert.Empty(Directory.Exists(_directory) ? Directory.GetFiles(_directory) : []);
    }

    [Theory]
    [InlineData(".png", new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 }, true)]
    [InlineData(".jpg", new byte[] { 0xFF, 0xD8, 0xFF, 0xE1, 0, 0, 0, 0, 0, 0, 0, 0 }, true)]
    [InlineData(".gif", new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0 }, true)]
    [InlineData(".webp", new byte[] { 0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50 }, true)]
    [InlineData(".bmp", new byte[] { 0x42, 0x4D, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }, true)]
    [InlineData(".png", new byte[] { 0xFF, 0xD8, 0xFF, 0xE1, 0, 0, 0, 0, 0, 0, 0, 0 }, false)]
    [InlineData(".webp", new byte[] { 0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20 }, false)]
    [InlineData(".gif", new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 }, false)]
    public void RecognizesImageSignatures(string extension, byte[] header, bool expected)
    {
        Assert.Equal(expected, ManagedAssetStore.MatchesImageSignature(header, extension));
    }

    [Fact]
    public void FindsAStoredFileByBareId()
    {
        var store = ImageStore();
        Directory.CreateDirectory(_directory);
        File.WriteAllBytes(Path.Combine(_directory, "cafe01.png"), PngBytes());

        Assert.Equal(Path.Combine(_directory, "cafe01.png"), store.FindByBareId("cafe01"));
        Assert.Null(store.FindByBareId("beef02"));
        Assert.Null(store.FindByBareId("cafe01.png"));
        Assert.Null(store.FindByBareId("../cafe01"));
    }

    [Theory]
    [InlineData("*")]
    [InlineData("?")]
    [InlineData("<")]
    [InlineData("cafe*")]
    [InlineData("foo:bar")]
    [InlineData("cafe 01")]
    public void BareIdLookupRefusesGlobAndForeignCharacters(string bareId)
    {
        // `*` fed into the search pattern would match every stored file and serve back an
        // asset the caller never named; only the minted id alphabet may reach the glob.
        var store = ImageStore();
        Directory.CreateDirectory(_directory);
        File.WriteAllBytes(Path.Combine(_directory, "cafe01.png"), PngBytes());

        Assert.Null(store.FindByBareId(bareId));
    }

    [Fact]
    public void MapsPathsBackToAssetIdsOnlyInsideTheDirectory()
    {
        var store = ImageStore();
        Assert.Equal("a.png", store.AssetIdForPath(Path.Combine(_directory, "a.png")));
        Assert.Null(store.AssetIdForPath(Path.Combine(Path.GetTempPath(), "a.png")));
        Assert.Null(store.AssetIdForPath(null));
    }

    private static byte[] PngBytes() =>
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];
}
