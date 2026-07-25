using System;
using System.IO;
using System.Runtime.InteropServices;

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

    /// <param name="runtimeRoot">
    /// The <c>TypstRuntime</c> directory containing <c>binaries/</c> and <c>typst-packages/</c>.
    /// Defaults to the copy the build places beside the running app.
    /// </param>
    public TypstBinaryProvider(string? runtimeRoot = null)
    {
        _runtimeRoot = runtimeRoot ?? Path.Combine(AppContext.BaseDirectory, "TypstRuntime");
    }

    /// <summary>The vendored mitex package root, passed to Typst as <c>--package-path</c>.</summary>
    public string PackagePath => Path.Combine(_runtimeRoot, "typst-packages");

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
            throw new TypstToolchainUnavailableException(
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
