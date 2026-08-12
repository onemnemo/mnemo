using Mnemo.Core.Enums;
using Mnemo.Host.Lifecycle;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;

using OpenFolderOutcome = Mnemo.Host.Lifecycle.LifecycleEndpoints.OpenFolderOutcome;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// Collects every test that repoints the data root. The override is a process-wide
/// environment variable and anything resolving <see cref="MnemoAppPaths"/> reads it
/// live, so a class in here running beside an unrelated one would hand that one a
/// temporary profile. Members run on their own.
/// </summary>
[CollectionDefinition(DataRootCollection.Name, DisableParallelization = true)]
public sealed class DataRootCollection
{
    public const string Name = "mnemo data root";
}

/// <summary>
/// The open-folder endpoint hands a path to the shell, so the only question that
/// matters is which strings can become that path. These cover the whole allowlist
/// and the answers a caller gets for everything outside it.
/// </summary>
[Collection(DataRootCollection.Name)]
public sealed class OpenFolderTests
{
    [Fact]
    public void DataResolvesToTheAppsOwnRoot()
    {
        using var root = new TemporaryDataRoot();

        Assert.Equal(OpenFolderOutcome.Ready, ResolveFolder("data", out var path));
        Assert.Equal(root.Path, path);
    }

    [Fact]
    public void LogsResolvesToTheDirectoryTheLoggerWritesInto()
    {
        using var root = new TemporaryDataRoot();

        // Asserting the endpoint's own formula would pass wherever the logs really are,
        // so the logger writes a line first and the resolved directory has to be the one
        // holding it.
        new LoggerService().Log(LogLevel.Info, "OpenFolderTests", "probe");

        Assert.Equal(OpenFolderOutcome.Ready, ResolveFolder("logs", out var path));
        Assert.NotEmpty(Directory.GetFiles(path, "log_*.txt"));
    }

    [Fact]
    public void AKnownTargetWithNoDirectoryYetIsReportedRatherThanLaunched()
    {
        using var root = new TemporaryDataRoot();

        // Nothing has been logged in this profile, so the directory is not there.
        Assert.Equal(OpenFolderOutcome.MissingDirectory, ResolveFolder("logs", out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Logs")]
    [InlineData("cache")]
    [InlineData(@"C:\Windows\System32")]
    [InlineData("../../../Windows")]
    [InlineData("data; calc.exe")]
    public void AnythingOutsideTheAllowlistResolvesToNothing(string? target)
    {
        using var root = new TemporaryDataRoot();

        Assert.Equal(OpenFolderOutcome.UnknownTarget, ResolveFolder(target, out var path));
        Assert.Equal(string.Empty, path);
    }

    private static OpenFolderOutcome ResolveFolder(string? target, out string path)
        => LifecycleEndpoints.ResolveFolder(target, out path);

    /// <summary>
    /// Points the app's data root at a temporary directory for the duration of a test
    /// and restores the previous value, so the process-wide variable never leaks and no
    /// test reads the developer's real profile.
    /// </summary>
    private sealed class TemporaryDataRoot : IDisposable
    {
        private readonly string? _previous;

        public TemporaryDataRoot()
        {
            // Resolved the way the paths helper resolves its override, so the comparisons
            // above are against the same normalised form.
            Path = System.IO.Path.GetFullPath(
                System.IO.Path.Combine(System.IO.Path.GetTempPath(), "mnemo-open-folder-" + Guid.NewGuid().ToString("n")));
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
