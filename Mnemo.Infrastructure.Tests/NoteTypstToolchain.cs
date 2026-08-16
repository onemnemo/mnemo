using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Locates the vendored Typst binary + mitex package and compiles source offline, so the
/// compile-smoke tests exercise the real binary the app ships. Skips gracefully when the binary
/// has not been restored (a fresh clone before scripts/restore-typst) or on an unsupported RID.
/// </summary>
internal static class NoteTypstToolchain
{
    public static bool Available => BinaryPath != null && PackagePath != null;

    public static readonly string? BinaryPath = ResolveBinaryPath();
    public static readonly string? PackagePath = ResolvePackagePath();

    // Anchored on the compile-time path of this source file, so the repo is found even when a test
    // run relocates AppContext.BaseDirectory (the /p:OutDir lock workaround does exactly that, which
    // otherwise leaves the toolchain "unavailable" and silently no-ops every compile-smoke test).
    // Falls back to the current directory and the base directory for any run where the source path
    // is stale (e.g. a checkout moved after build).
    private static string? RepoRoot()
    {
        foreach (var start in new[] { Path.GetDirectoryName(ThisFilePath()), Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var found = WalkUpForRuntime(start);
            if (found != null)
                return found;
        }
        return null;
    }

    private static string ThisFilePath([CallerFilePath] string path = "") => path;

    private static string? WalkUpForRuntime(string? startDir)
    {
        if (string.IsNullOrEmpty(startDir))
            return null;
        var dir = new DirectoryInfo(startDir);
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "Mnemo.Host", "TypstRuntime")))
                return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    private static string HostRid()
    {
        var arch = RuntimeInformation.OSArchitecture switch
        {
            Architecture.X64 => "x64",
            Architecture.Arm64 => "arm64",
            _ => "unknown"
        };
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return $"win-{arch}";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return $"linux-{arch}";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX)) return $"osx-{arch}";
        return $"unknown-{arch}";
    }

    private static string? ResolveBinaryPath()
    {
        var root = RepoRoot();
        if (root == null) return null;
        var exe = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "typst.exe" : "typst";
        var path = Path.Combine(root, "Mnemo.Host", "TypstRuntime", "binaries", HostRid(), exe);
        return File.Exists(path) ? path : null;
    }

    private static string? ResolvePackagePath()
    {
        var root = RepoRoot();
        if (root == null) return null;
        var path = Path.Combine(root, "Mnemo.Host", "TypstRuntime", "typst-packages");
        return Directory.Exists(path) ? path : null;
    }

    private static readonly string? FontPath = ResolveFontPath();

    private static string? ResolveFontPath()
    {
        var root = RepoRoot();
        if (root == null) return null;
        var path = Path.Combine(root, "Mnemo.Host", "TypstRuntime", "fonts");
        return Directory.Exists(path) ? path : null;
    }

    /// <summary>Compiles <paramref name="typstSource"/> to PDF in an isolated workdir with the network
    /// disabled (empty download cache + vendored package path). Returns the exit code and stderr.</summary>
    public static (int ExitCode, string StdErr) Compile(string typstSource, IReadOnlyDictionary<string, byte[]>? workdirFiles = null)
    {
        if (!Available)
            throw new InvalidOperationException("Typst toolchain is not available.");

        var work = Path.Combine(Path.GetTempPath(), "mnemo-typst-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        var emptyCache = Path.Combine(work, ".cache");
        Directory.CreateDirectory(emptyCache);
        try
        {
            if (workdirFiles != null)
            {
                foreach (var (relative, bytes) in workdirFiles)
                {
                    var target = Path.Combine(work, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                    File.WriteAllBytes(target, bytes);
                }
            }

            var typPath = Path.Combine(work, "doc.typ");
            File.WriteAllText(typPath, typstSource);
            var pdfPath = Path.Combine(work, "doc.pdf");

            var psi = new ProcessStartInfo(BinaryPath!)
            {
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                WorkingDirectory = work
            };
            psi.ArgumentList.Add("compile");
            psi.ArgumentList.Add("--package-path"); psi.ArgumentList.Add(PackagePath!);
            psi.ArgumentList.Add("--package-cache-path"); psi.ArgumentList.Add(emptyCache);
            psi.ArgumentList.Add("--root"); psi.ArgumentList.Add(work);
            if (FontPath != null)
            {
                psi.ArgumentList.Add("--font-path"); psi.ArgumentList.Add(FontPath);
            }
            psi.ArgumentList.Add("--ignore-system-fonts");
            psi.ArgumentList.Add(typPath);
            psi.ArgumentList.Add(pdfPath);
            psi.Environment["TYPST_PACKAGE_CACHE_PATH"] = emptyCache;

            using var process = Process.Start(psi)!;
            var stderr = process.StandardError.ReadToEnd();
            process.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(60_000))
            {
                try { process.Kill(true); } catch { /* best effort */ }
                return (-1, "Typst compile timed out.");
            }
            return (process.ExitCode, stderr);
        }
        finally
        {
            try { Directory.Delete(work, recursive: true); } catch { /* best effort cleanup */ }
        }
    }
}
