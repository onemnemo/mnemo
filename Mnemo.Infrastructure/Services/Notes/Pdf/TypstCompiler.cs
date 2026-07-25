using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// Runs the vendored Typst binary as a subprocess to turn a <c>.typ</c> source into PDF or per-page
/// PNG bytes, fully offline (the vendored package path resolves mitex, the cache is neutered).
/// </summary>
/// <remarks>
/// Every compile is a fresh process against a caller-owned working directory. The directory doubles
/// as the compile <c>--root</c>, so the only files Typst can read are the source and whatever the
/// caller staged there (images) - a note cannot reach arbitrary paths on the machine. The process is
/// bounded by a hard timeout and by the caller's cancellation token; either one kills the whole
/// process tree rather than leaving an orphan. A non-zero exit surfaces as
/// <see cref="TypstCompileException"/> carrying the binary's stderr.
/// </remarks>
public sealed class TypstCompiler
{
    private readonly TypstBinaryProvider _binary;
    private readonly TimeSpan _timeout;

    /// <param name="timeout">
    /// Hard cap on a single compile. Generous by default: a large note can take a couple of seconds,
    /// and a runaway compile is caught here rather than hanging a request.
    /// </param>
    public TypstCompiler(TypstBinaryProvider binary, TimeSpan? timeout = null)
    {
        _binary = binary ?? throw new ArgumentNullException(nameof(binary));
        _timeout = timeout ?? TimeSpan.FromSeconds(60);
    }

    /// <summary>Compiles <paramref name="typstSource"/> to a single PDF, returning its bytes.</summary>
    /// <param name="workDir">
    /// A caller-owned directory used as both the sandbox root and a scratch area. The caller stages
    /// referenced images here and is responsible for deleting it afterwards.
    /// </param>
    public async Task<byte[]> CompilePdfAsync(string typstSource, string workDir, CancellationToken cancellationToken = default)
    {
        var outPath = Path.Combine(workDir, "__mnemo_out.pdf");
        await RunAsync(typstSource, workDir, format: "pdf", outputTarget: outPath, ppi: null, cancellationToken).ConfigureAwait(false);
        if (!File.Exists(outPath))
            throw new TypstCompileException("Typst reported success but produced no PDF.", string.Empty);
        var bytes = await File.ReadAllBytesAsync(outPath, cancellationToken).ConfigureAwait(false);
        TryDelete(outPath);
        return bytes;
    }

    /// <summary>Compiles <paramref name="typstSource"/> to one PNG per page, in page order.</summary>
    public async Task<IReadOnlyList<byte[]>> CompilePngPagesAsync(string typstSource, string workDir, int ppi, CancellationToken cancellationToken = default)
    {
        // Typst fills {p} with the 1-based page number, unpadded (page1.png, page2.png, ...).
        var target = Path.Combine(workDir, "__mnemo_page{p}.png");
        await RunAsync(typstSource, workDir, format: "png", outputTarget: target, ppi: Math.Clamp(ppi, 72, 300), cancellationToken).ConfigureAwait(false);

        // Sort by the parsed page number, not lexically, so page10 does not land before page2.
        var pages = Directory.EnumerateFiles(workDir, "__mnemo_page*.png")
            .Select(path => (path, page: ParsePageNumber(path)))
            .Where(x => x.page >= 0)
            .OrderBy(x => x.page)
            .ToList();

        var result = new List<byte[]>(pages.Count);
        foreach (var (path, _) in pages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            result.Add(await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false));
            TryDelete(path);
        }

        return result;
    }

    private static int ParsePageNumber(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path); // __mnemo_pageN
        const string prefix = "__mnemo_page";
        if (!name.StartsWith(prefix, StringComparison.Ordinal))
            return -1;
        return int.TryParse(name.AsSpan(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : -1;
    }

    private async Task RunAsync(string typstSource, string workDir, string format, string outputTarget, int? ppi, CancellationToken cancellationToken)
    {
        var binaryPath = _binary.ResolveBinaryPath();
        Directory.CreateDirectory(workDir);

        var srcPath = Path.Combine(workDir, "__mnemo_doc.typ");
        await File.WriteAllTextAsync(srcPath, typstSource, cancellationToken).ConfigureAwait(false);

        // A per-compile empty cache dir: mitex resolves from --package-path, so nothing is ever
        // fetched, but pointing the cache at throwaway space keeps a compile from touching the
        // user's real package cache even in a fallback path.
        var cacheDir = Path.Combine(workDir, "__mnemo_cache");
        Directory.CreateDirectory(cacheDir);

        var psi = new ProcessStartInfo(binaryPath)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = workDir
        };
        psi.ArgumentList.Add("compile");
        psi.ArgumentList.Add("--package-path");
        psi.ArgumentList.Add(_binary.PackagePath);
        psi.ArgumentList.Add("--package-cache-path");
        psi.ArgumentList.Add(cacheDir);
        psi.ArgumentList.Add("--root");
        psi.ArgumentList.Add(workDir);
        // Bundled Geist fonts + no system fonts: deterministic output that matches the app's type.
        if (Directory.Exists(_binary.FontPath))
        {
            psi.ArgumentList.Add("--font-path");
            psi.ArgumentList.Add(_binary.FontPath);
        }
        psi.ArgumentList.Add("--ignore-system-fonts");
        psi.ArgumentList.Add("--format");
        psi.ArgumentList.Add(format);
        if (ppi is int p)
        {
            psi.ArgumentList.Add("--ppi");
            psi.ArgumentList.Add(p.ToString(CultureInfo.InvariantCulture));
        }
        psi.ArgumentList.Add(srcPath);
        psi.ArgumentList.Add(outputTarget);
        psi.Environment["TYPST_PACKAGE_CACHE_PATH"] = cacheDir;

        using var process = new Process { StartInfo = psi };
        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            throw new TypstCompileException($"Failed to start the Typst process at '{binaryPath}'.", ex.Message, ex);
        }

        // Drain both pipes concurrently so a chatty binary cannot fill a buffer and deadlock the wait.
        var stdErrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        var stdOutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);

        using var timeoutCts = new CancellationTokenSource(_timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        try
        {
            await process.WaitForExitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            KillTree(process);
            if (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
                throw new TypstCompileException($"Typst compile exceeded the {_timeout.TotalSeconds:0}s timeout and was terminated.", string.Empty);
            // The caller cancelled (superseded preview / aborted request): propagate as cancellation.
            cancellationToken.ThrowIfCancellationRequested();
            throw;
        }

        var stderr = await SafeAwait(stdErrTask).ConfigureAwait(false);
        await SafeAwait(stdOutTask).ConfigureAwait(false);

        if (process.ExitCode != 0)
            throw new TypstCompileException($"Typst exited with code {process.ExitCode}.", stderr);
    }

    private static void KillTree(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Best effort: the process may have exited between the check and the kill.
        }
    }

    private static async Task<string> SafeAwait(Task<string> task)
    {
        try
        {
            return await task.ConfigureAwait(false);
        }
        catch
        {
            return string.Empty;
        }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { /* best effort */ }
    }
}

/// <summary>Thrown when a Typst compile fails; <see cref="StdErr"/> carries the binary's diagnostics.</summary>
public sealed class TypstCompileException : Exception
{
    public TypstCompileException(string message, string stdErr, Exception? inner = null)
        : base(Compose(message, stdErr), inner)
    {
        StdErr = stdErr ?? string.Empty;
    }

    /// <summary>The raw stderr from the Typst process, useful for logs but not for end users.</summary>
    public string StdErr { get; }

    private static string Compose(string message, string stdErr)
    {
        if (string.IsNullOrWhiteSpace(stdErr))
            return message;
        var trimmed = stdErr.Trim();
        return new StringBuilder(message).Append('\n').Append(trimmed).ToString();
    }
}
