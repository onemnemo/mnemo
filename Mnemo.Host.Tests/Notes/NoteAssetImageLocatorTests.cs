using Mnemo.Host.Assets;
using Mnemo.Host.Notes;
using Xunit;

namespace Mnemo.Host.Tests.Notes;

public sealed class NoteAssetImageLocatorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "mnemo-locator-tests", Guid.NewGuid().ToString("N"));
    private readonly string _noteAssetsDir;
    private readonly string _imagesDir;

    public NoteAssetImageLocatorTests()
    {
        _noteAssetsDir = Path.Combine(_root, "note-assets");
        _imagesDir = Path.Combine(_root, "images");
        Directory.CreateDirectory(_noteAssetsDir);
        Directory.CreateDirectory(_imagesDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    private NoteAssetImageLocator Locator()
    {
        var store = new ManagedAssetStore(() => _noteAssetsDir, ManagedAssetStore.ImageExtensions);
        return new NoteAssetImageLocator(store, _noteAssetsDir, _imagesDir);
    }

    private string WriteFile(string dir, string name)
    {
        var path = Path.Combine(dir, name);
        File.WriteAllBytes(path, [1, 2, 3]);
        return path;
    }

    [Fact]
    public void ResolvesManagedAssetIdInNoteAssets()
    {
        var expected = WriteFile(_noteAssetsDir, "a1b2c3d4.png");
        Assert.Equal(expected, Locator().LocateImageFilePath("a1b2c3d4.png"));
    }

    [Fact]
    public void ResolvesBareGuidWithoutExtension()
    {
        var expected = WriteFile(_noteAssetsDir, "a1b2c3d4.png");
        // The reference arrives without the extension; the store finds it by glob.
        Assert.Equal(expected, Locator().LocateImageFilePath("a1b2c3d4"));
    }

    [Fact]
    public void ResolvesAttachmentReferenceByBareGuid()
    {
        var expected = WriteFile(_noteAssetsDir, "cafe0123.png");
        Assert.Equal(expected, Locator().LocateImageFilePath("attachment:cafe0123:diagram.png"));
    }

    [Fact]
    public void FallsBackToLegacyImagesDirectory()
    {
        // Nothing in note-assets; the file lives in the shared images directory instead.
        var expected = WriteFile(_imagesDir, "deadbeef.png");
        Assert.Equal(expected, Locator().LocateImageFilePath("deadbeef"));
    }

    [Fact]
    public void HonorsAbsolutePathUnderImagesDirectory()
    {
        var path = WriteFile(_imagesDir, "block1.png");
        Assert.Equal(Path.GetFullPath(path), Locator().LocateImageFilePath(path));
    }

    [Fact]
    public void HonorsAbsolutePathUnderNoteAssetsDirectory()
    {
        var path = WriteFile(_noteAssetsDir, "b2c3d4e5.png");
        Assert.Equal(Path.GetFullPath(path), Locator().LocateImageFilePath(path));
    }

    [Fact]
    public void RejectsAbsolutePathOutsideKnownDirectories()
    {
        var outside = WriteFile(_root, "loose.png"); // directly under _root, not under either managed dir
        Assert.Null(Locator().LocateImageFilePath(outside));
    }

    [Fact]
    public void ReturnsNullForMissingAbsolutePath()
    {
        var missing = Path.Combine(_imagesDir, "not-there.png");
        Assert.Null(Locator().LocateImageFilePath(missing));
    }

    [Fact]
    public void ReturnsNullForUnknownManagedId()
    {
        Assert.Null(Locator().LocateImageFilePath("00000000.png"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ReturnsNullForBlankReference(string reference)
    {
        Assert.Null(Locator().LocateImageFilePath(reference));
    }

    [Fact]
    public void ReturnsNullForRemoteUrl()
    {
        // A url is neither a managed id nor a rooted path; nothing on disk backs it.
        Assert.Null(Locator().LocateImageFilePath("https://example.com/x.png"));
    }
}
