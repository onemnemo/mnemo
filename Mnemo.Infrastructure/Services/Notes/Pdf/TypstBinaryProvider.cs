using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// Locates the vendored Typst binary and mitex package that the build copies next to the app.
/// </summary>
/// <remarks>
/// The binary is fetched per-RID by <c>scripts/restore-typst</c> and is not committed, so a fresh
/// checkout that has not run the script has the mitex package but no binary. This provider reports
/// that state through <see cref="IsBinaryAvailable"/> and, when asked to resolve anyway, throws a
/// message that names the restore step rather than a bare file-not-found. The runtime root is
/// overridable so tests can point at the source tree, where the binary lives under
/// <c>Mnemo.Host/TypstRuntime</c> rather than beside a built app.
/// </remarks>
public sealed class TypstBinaryProvider
{
    private readonly string _runtimeRoot;
    private readonly string _cacheRoot;
    private readonly object _unpackLock = new();
    private string? _unpacked;
    private string? _unpackError;

    /// <param name="runtimeRoot">
    /// The <c>TypstRuntime</c> directory containing <c>binaries/</c> and <c>typst-packages/</c>.
    /// Defaults to the copy the build places beside the running app.
    /// </param>
    /// <param name="cacheRoot">Where a zipped package set is unpacked. Defaults to a per-user cache.</param>
    public TypstBinaryProvider(string? runtimeRoot = null, string? cacheRoot = null)
    {
        _runtimeRoot = runtimeRoot ?? Path.Combine(AppContext.BaseDirectory, "TypstRuntime");
        _cacheRoot = cacheRoot ?? DefaultCacheRoot();
    }

    /// <summary>The vendored mitex package root, passed to Typst as <c>--package-path</c>.</summary>
    /// <remarks>
    /// The macOS build ships the packages as <c>typst-packages.zip</c>, because codesign rejects
    /// the dotted version folder inside an app bundle. That zip is unpacked into the cache here.
    /// </remarks>
    public string PackagePath
    {
        get
        {
            var shipped = Path.Combine(_runtimeRoot, "typst-packages");
            var zip = shipped + ".zip";
            if (Directory.Exists(shipped) || !File.Exists(zip))
                return shipped;

            lock (_unpackLock)
            {
                // The OS can clear the cache while the app runs.
                if (_unpacked is not null && Directory.Exists(_unpacked))
                    return _unpacked;

                try
                {
                    _unpacked = Unpack(zip);
                    _unpackError = null;
                    return _unpacked;
                }
                catch (Exception ex)
                {
                    _unpacked = null;
                    _unpackError = $"Could not unpack '{zip}' into '{_cacheRoot}': {ex.Message}";
                    return shipped;
                }
            }
        }
    }

    private string Unpack(string zip)
    {
        string hash;
        using (var stream = File.OpenRead(zip))
            hash = Convert.ToHexString(SHA256.HashData(stream))[..16].ToLowerInvariant();

        var target = Path.Combine(_cacheRoot, hash);
        if (IsComplete(zip, target))
            return target;

        var staging = target + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            ZipFile.ExtractToDirectory(zip, staging);
            if (Directory.Exists(target))
                Directory.Delete(target, recursive: true);
            Directory.Move(staging, target);
        }
        catch (IOException) when (IsComplete(zip, target))
        {
            // Another process finished the same unpack first.
        }
        finally
        {
            if (Directory.Exists(staging))
                Directory.Delete(staging, recursive: true);
        }
        return target;
    }

    // A cache the OS has partly cleaned is unpacked again.
    private static bool IsComplete(string zip, string target)
    {
        if (!Directory.Exists(target))
            return false;

        using var archive = ZipFile.OpenRead(zip);
        return archive.Entries
            .Where(entry => entry.Name.Length > 0)
            .All(entry =>
            {
                var file = new FileInfo(Path.Combine(target, entry.FullName));
                return file.Exists && file.Length == entry.Length;
            });
    }

    private static string DefaultCacheRoot()
    {
        var root = OperatingSystem.IsMacOS()
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "Caches")
            : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(root, "Mnemo", "typst-packages");
    }

    /// <summary>
    /// The bundled font directory, passed to Typst as <c>--font-path</c>. Holds the app's Geist
    /// family so a PDF matches the on-screen note rather than falling back to Typst's serif default.
    /// </summary>
    public string FontPath => Path.Combine(_runtimeRoot, "fonts");

    /// <summary>The host RID folder the matching binary was restored into (e.g. <c>win-x64</c>).</summary>
    public static string HostRid
    {
        get
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
    }

    private static string BinaryFileName =>
        RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "typst.exe" : "typst";

    /// <summary>The path the binary would occupy for this host, whether or not it has been restored.</summary>
    public string BinaryPath => Path.Combine(_runtimeRoot, "binaries", HostRid, BinaryFileName);

    /// <summary>True once the vendored mitex package is present (committed, so normally always true).</summary>
    public bool IsPackageAvailable => Directory.Exists(PackagePath);

    /// <summary>True once the per-RID binary has been restored beside the app.</summary>
    public bool IsBinaryAvailable => File.Exists(BinaryPath);

    /// <summary>True when both halves of the toolchain are in place and a compile can run.</summary>
    public bool IsAvailable => IsBinaryAvailable && IsPackageAvailable;

    /// <summary>
    /// Returns the binary path, or throws a <see cref="TypstToolchainUnavailableException"/> that
    /// names what is missing and how to restore it.
    /// </summary>
    public string ResolveBinaryPath()
    {
        if (!IsPackageAvailable)
            throw new TypstToolchainUnavailableException(_unpackError ??
                $"The vendored mitex package is missing at '{PackagePath}'. It is committed under " +
                "Mnemo.Host/TypstRuntime/typst-packages and should ship with the app.");

        if (!IsBinaryAvailable)
            throw new TypstToolchainUnavailableException(
                $"The Typst binary for '{HostRid}' is missing at '{BinaryPath}'. Run " +
                "scripts/restore-typst to fetch it (it is not committed).");

        return BinaryPath;
    }
}

/// <summary>Thrown when the Typst binary or mitex package cannot be found beside the app.</summary>
public sealed class TypstToolchainUnavailableException : Exception
{
    public TypstToolchainUnavailableException(string message) : base(message)
    {
    }
}
