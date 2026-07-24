using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// Exports notes to PDF (and per-page PNG previews) by mapping the note to a Typst document and
/// compiling it with the vendored Typst binary. Replaces the QuestPDF-backed
/// <see cref="NotePdfExportService"/>; equation blocks render as real vector math via mitex rather
/// than the regex-to-Unicode degrade the web host had before.
/// </summary>
/// <remarks>
/// Each call gets its own temporary working directory that serves as the compile sandbox root. The
/// note's referenced images are the only external files staged into it, so a compile can read
/// nothing else on the machine. The directory is deleted afterwards regardless of outcome.
/// </remarks>
public sealed class TypstNotePdfExportService : INotePdfExportService
{
    private readonly TypstCompiler _compiler;
    private readonly INotePdfImageLocator _imageLocator;

    /// <param name="imageLocator">
    /// Turns a note's image references into readable file paths. Defaults to treating references as
    /// direct paths (the desktop shape); the web host injects one that resolves managed asset ids.
    /// </param>
    public TypstNotePdfExportService(TypstCompiler compiler, INotePdfImageLocator? imageLocator = null)
    {
        _compiler = compiler ?? throw new ArgumentNullException(nameof(compiler));
        _imageLocator = imageLocator ?? DirectPathImageLocator.Instance;
    }

    public Task<byte[]> GeneratePdfAsync(Note note, NotePdfExportOptions options, CancellationToken cancellationToken = default)
        => RunInWorkDirAsync(note, options, (source, workDir) => _compiler.CompilePdfAsync(source, workDir, cancellationToken), cancellationToken);

    public Task<IReadOnlyList<byte[]>> GeneratePreviewPngPagesAsync(Note note, NotePdfExportOptions options, CancellationToken cancellationToken = default)
    {
        var ppi = options.PreviewRasterDpi;
        return RunInWorkDirAsync(note, options, (source, workDir) => _compiler.CompilePngPagesAsync(source, workDir, ppi, cancellationToken), cancellationToken);
    }

    private async Task<T> RunInWorkDirAsync<T>(
        Note note,
        NotePdfExportOptions options,
        Func<string, string, Task<T>> compile,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var workDir = Path.Combine(Path.GetTempPath(), "mnemo-typst-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDir);
        try
        {
            // Compose (and stage images) off the caller's thread: a large note is ~150ms of CPU and
            // file copies, which should not block whoever awaited us (e.g. a UI thread).
            var source = await Task.Run(() =>
            {
                var resolver = new StagingAssetResolver(workDir, _imageLocator);
                return NoteTypstDocumentComposer.Compose(note, options, resolver);
            }, cancellationToken).ConfigureAwait(false);

            return await compile(source, workDir).ConfigureAwait(false);
        }
        finally
        {
            TryDeleteDir(workDir);
        }
    }

    private static void TryDeleteDir(string dir)
    {
        try { Directory.Delete(dir, recursive: true); } catch { /* best effort cleanup */ }
    }

    /// <summary>
    /// Copies each referenced image into the compile sandbox and hands the composer a root-relative
    /// path Typst can read. Typst picks an image's format from its extension, so a reference without
    /// a usable extension is sniffed from its magic bytes; anything that cannot be classified is
    /// dropped (the composer then renders the alt text) rather than failing the whole document.
    /// </summary>
    private sealed class StagingAssetResolver : INoteTypstAssetResolver
    {
        private const string StagedDirName = "__mnemo_img";
        private readonly string _workDir;
        private readonly INotePdfImageLocator _locator;
        private readonly Dictionary<string, string?> _byReference = new(StringComparer.Ordinal);
        private int _next;

        public StagingAssetResolver(string workDir, INotePdfImageLocator locator)
        {
            _workDir = workDir;
            _locator = locator;
        }

        public string? ResolveImagePath(string reference)
        {
            if (string.IsNullOrWhiteSpace(reference))
                return null;

            // The same image used twice is staged once.
            if (_byReference.TryGetValue(reference, out var cached))
                return cached;

            var staged = Stage(reference);
            _byReference[reference] = staged;
            return staged;
        }

        private string? Stage(string reference)
        {
            var filePath = _locator.LocateImageFilePath(reference);
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath))
                return null;

            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(filePath);
            }
            catch
            {
                return null;
            }

            if (bytes.Length == 0)
                return null;

            var ext = NormalizeImageExtension(Path.GetExtension(filePath)) ?? SniffImageExtension(bytes);
            if (ext == null)
                return null;

            var stagedDir = Path.Combine(_workDir, StagedDirName);
            Directory.CreateDirectory(stagedDir);

            var name = _next++.ToString(System.Globalization.CultureInfo.InvariantCulture) + ext;
            try
            {
                File.WriteAllBytes(Path.Combine(stagedDir, name), bytes);
            }
            catch
            {
                return null;
            }

            // Root-relative for the compile --root (== _workDir); forward slashes for Typst.
            return "/" + StagedDirName + "/" + name;
        }

        private static string? NormalizeImageExtension(string? ext)
        {
            if (string.IsNullOrWhiteSpace(ext))
                return null;
            return ext.ToLowerInvariant() switch
            {
                ".png" => ".png",
                ".jpg" or ".jpeg" => ".jpg",
                ".gif" => ".gif",
                ".bmp" => ".bmp",
                ".svg" => ".svg",
                ".webp" => ".webp",
                _ => null
            };
        }

        private static string? SniffImageExtension(byte[] bytes)
        {
            static bool StartsWith(byte[] b, params byte[] sig)
            {
                if (b.Length < sig.Length) return false;
                for (var i = 0; i < sig.Length; i++)
                    if (b[i] != sig[i]) return false;
                return true;
            }

            if (StartsWith(bytes, 0x89, 0x50, 0x4E, 0x47)) return ".png";
            if (StartsWith(bytes, 0xFF, 0xD8, 0xFF)) return ".jpg";
            if (StartsWith(bytes, 0x47, 0x49, 0x46, 0x38)) return ".gif";
            if (StartsWith(bytes, 0x42, 0x4D)) return ".bmp";
            // RIFF....WEBP
            if (bytes.Length >= 12 && StartsWith(bytes, 0x52, 0x49, 0x46, 0x46) &&
                bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
                return ".webp";
            // SVG: look for "<svg" near the start, tolerating a BOM or XML prolog.
            var head = System.Text.Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 256));
            if (head.Contains("<svg", StringComparison.OrdinalIgnoreCase))
                return ".svg";
            return null;
        }
    }
}
