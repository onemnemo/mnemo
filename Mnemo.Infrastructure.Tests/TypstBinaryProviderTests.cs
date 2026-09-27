using System.IO.Compression;

using Mnemo.Infrastructure.Services.Notes.Pdf;

namespace Mnemo.Infrastructure.Tests;

public sealed class TypstBinaryProviderTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "mnemo-typst-provider-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public void PackagePath_PrefersTheShippedFolder()
    {
        var runtime = Directory.CreateDirectory(Path.Combine(_root, "runtime", "typst-packages")).Parent!.FullName;
        WriteZip(Path.Combine(runtime, "typst-packages.zip"));

        var provider = new TypstBinaryProvider(runtime, Path.Combine(_root, "cache"));

        Assert.Equal(Path.Combine(runtime, "typst-packages"), provider.PackagePath);
        Assert.False(Directory.Exists(Path.Combine(_root, "cache")));
    }

    [Fact]
    public void PackagePath_UnpacksTheZipAndRepairsAPartlyCleanedCache()
    {
        var runtime = Directory.CreateDirectory(Path.Combine(_root, "runtime")).FullName;
        WriteZip(Path.Combine(runtime, "typst-packages.zip"));
        var cache = Path.Combine(_root, "cache");

        var provider = new TypstBinaryProvider(runtime, cache);
        var unpacked = provider.PackagePath;

        Assert.Equal(cache, Path.GetDirectoryName(unpacked));
        var lib = Path.Combine(unpacked, "preview", "mitex", "0.2.7", "lib.typ");
        Assert.Equal("#let mitex = none", File.ReadAllText(lib));
        Assert.True(new TypstBinaryProvider(runtime, cache).IsPackageAvailable);

        File.Delete(lib);
        Assert.Equal(unpacked, new TypstBinaryProvider(runtime, cache).PackagePath);
        Assert.True(File.Exists(lib));
        Assert.Single(Directory.GetDirectories(cache));

        Directory.Delete(cache, recursive: true);
        Assert.Equal(unpacked, provider.PackagePath);
        Assert.True(File.Exists(lib));
    }

    [Fact]
    public void PackagePath_FallsBackToTheShippedPathWhenTheZipIsCorrupt()
    {
        var runtime = Directory.CreateDirectory(Path.Combine(_root, "runtime")).FullName;
        File.WriteAllText(Path.Combine(runtime, "typst-packages.zip"), "not a zip");

        var provider = new TypstBinaryProvider(runtime, Path.Combine(_root, "cache"));

        Assert.Equal(Path.Combine(runtime, "typst-packages"), provider.PackagePath);
        Assert.False(provider.IsPackageAvailable);
        var cache = Path.Combine(_root, "cache");
        Assert.False(Directory.Exists(cache) && Directory.EnumerateFileSystemEntries(cache).Any());
        var error = Assert.Throws<TypstToolchainUnavailableException>(provider.ResolveBinaryPath);
        Assert.Contains("Could not unpack", error.Message);
    }

    private static void WriteZip(string path)
    {
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        archive.CreateEntry("preview/");
        using var writer = new StreamWriter(archive.CreateEntry("preview/mitex/0.2.7/lib.typ").Open());
        writer.Write("#let mitex = none");
    }
}
