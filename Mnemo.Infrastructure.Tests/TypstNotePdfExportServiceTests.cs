using System.Text;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Pdf;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Exercises the real runtime service end-to-end against the vendored binary, offline. Skips when
/// the binary has not been restored (fresh clone) via the same guard the composer smoke tests use.
/// </summary>
public sealed class TypstNotePdfExportServiceTests
{
    // 1x1 RGBA PNG with a valid IDAT CRC (Typst's decoder rejects a bad CRC).
    private const string OnePixelPngBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4////fwAJ+wP99djxmgAAAABJRU5ErkJggg==";

    private static TypstBinaryProvider SourceTreeProvider()
    {
        // The test output has no copied runtime; point the provider at the source tree, whose layout
        // (binaries/<rid>, typst-packages) matches what the build copies beside the app.
        var runtimeRoot = Path.GetDirectoryName(NoteTypstToolchain.PackagePath!)!;
        return new TypstBinaryProvider(runtimeRoot);
    }

    private static TypstNotePdfExportService Service()
        => new(new TypstCompiler(SourceTreeProvider()));

    private static Note NoteWith(params Block[] blocks) => new() { Title = "Export Test", Blocks = blocks.ToList() };

    private static Block Leaf(BlockType type, string text, BlockPayload? payload = null) => new()
    {
        Id = type + "-id",
        Type = type,
        Spans = [InlineSpan.Plain(text)],
        Payload = payload ?? new EmptyPayload()
    };

    private static bool IsPdf(byte[] bytes) =>
        bytes.Length > 4 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F';

    private static bool IsPng(byte[] bytes) =>
        bytes.Length > 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47;

    [Fact]
    public async Task GeneratePdfAsync_ProducesValidPdf()
    {
        if (!NoteTypstToolchain.Available) return;

        var note = NoteWith(
            Leaf(BlockType.Heading1, "Chapter"),
            Leaf(BlockType.Text, "A paragraph with an equation."),
            Leaf(BlockType.Equation, "ignored", new EquationPayload("\\int_0^1 x^2\\,dx = \\frac{1}{3}")),
            Leaf(BlockType.BulletList, "a point"),
            Leaf(BlockType.Code, "ignored", new CodePayload("python", "print(\"hi\")")));

        var bytes = await Service().GeneratePdfAsync(note, new NotePdfExportOptions());

        Assert.True(IsPdf(bytes), "Expected a PDF stream.");
        Assert.True(bytes.Length > 500, "PDF looks implausibly small.");
    }

    [Fact]
    public async Task GeneratePreviewPngPagesAsync_ReturnsPngPerPage()
    {
        if (!NoteTypstToolchain.Available) return;

        var note = NoteWith(
            Leaf(BlockType.Heading1, "Preview"),
            Leaf(BlockType.Text, "Some body copy for a preview render."));

        var pages = await Service().GeneratePreviewPngPagesAsync(note, new NotePdfExportOptions { PreviewRasterDpi = 96 });

        Assert.NotEmpty(pages);
        Assert.All(pages, page => Assert.True(IsPng(page), "Every preview page should be a PNG."));
    }

    [Fact]
    public async Task GeneratePdfAsync_EmbedsStagedImage()
    {
        if (!NoteTypstToolchain.Available) return;

        var imgPath = Path.Combine(Path.GetTempPath(), "mnemo-img-" + Guid.NewGuid().ToString("N") + ".png");
        await File.WriteAllBytesAsync(imgPath, Convert.FromBase64String(OnePixelPngBase64));
        try
        {
            var note = NoteWith(
                Leaf(BlockType.Text, "Above the image."),
                Leaf(BlockType.Image, "", new ImagePayload(Path: imgPath, Alt: "one pixel", Width: 64)));

            var bytes = await Service().GeneratePdfAsync(note, new NotePdfExportOptions());

            Assert.True(IsPdf(bytes), "A note with an image should still compile to a PDF.");
        }
        finally
        {
            try { File.Delete(imgPath); } catch { /* best effort */ }
        }
    }

    [Fact]
    public async Task GeneratePdfAsync_MissingImagePath_DoesNotFailDocument()
    {
        if (!NoteTypstToolchain.Available) return;

        var note = NoteWith(
            Leaf(BlockType.Text, "Body."),
            Leaf(BlockType.Image, "", new ImagePayload(Path: "Z:/does/not/exist.png", Alt: "gone", Width: 40)));

        // An unresolved image must degrade to alt text, not throw or abort the compile.
        var bytes = await Service().GeneratePdfAsync(note, new NotePdfExportOptions());
        Assert.True(IsPdf(bytes));
    }

    [Fact]
    public async Task GeneratePdfAsync_HonorsCancellation()
    {
        if (!NoteTypstToolchain.Available) return;

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var note = NoteWith(Leaf(BlockType.Text, "never compiled"));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => Service().GeneratePdfAsync(note, new NotePdfExportOptions(), cts.Token));
    }

    [Fact]
    public async Task Compiler_InvalidSource_ThrowsWithStdErr()
    {
        if (!NoteTypstToolchain.Available) return;

        var compiler = new TypstCompiler(SourceTreeProvider());
        var workDir = Path.Combine(Path.GetTempPath(), "mnemo-typst-badsrc-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDir);
        try
        {
            // Unclosed function call: a hard parse error the binary reports on stderr with a non-zero exit.
            var ex = await Assert.ThrowsAsync<TypstCompileException>(
                () => compiler.CompilePdfAsync("#box(", workDir));
            Assert.False(string.IsNullOrWhiteSpace(ex.StdErr), "The compile error should carry Typst's stderr.");
        }
        finally
        {
            try { Directory.Delete(workDir, recursive: true); } catch { /* best effort */ }
        }
    }

    [Fact]
    public void BinaryProvider_BogusRoot_ThrowsToolchainUnavailable()
    {
        var provider = new TypstBinaryProvider(Path.Combine(Path.GetTempPath(), "no-such-typst-" + Guid.NewGuid().ToString("N")));
        Assert.False(provider.IsAvailable);
        Assert.Throws<TypstToolchainUnavailableException>(() => provider.ResolveBinaryPath());
    }

    [Fact]
    public void BinaryProvider_SourceTree_IsAvailable()
    {
        if (!NoteTypstToolchain.Available) return;

        var provider = SourceTreeProvider();
        Assert.True(provider.IsPackageAvailable);
        Assert.True(provider.IsBinaryAvailable);
        Assert.True(File.Exists(provider.ResolveBinaryPath()));
    }
}
