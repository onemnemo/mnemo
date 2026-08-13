using System;
using System.IO;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Tests;

public sealed class MnemoAppPathsTests
{
    [Fact]
    public void GetLocalUserDataRoot_UsesOverride_WhenEnvironmentVariableSet()
    {
        var overrideRoot = Path.Combine(Path.GetTempPath(), "mnemo-data-override");
        using var scope = new DataDirOverrideScope(overrideRoot);

        var expectedRoot = Path.GetFullPath(overrideRoot);
        Assert.Equal(expectedRoot, MnemoAppPaths.GetLocalUserDataRoot());
        Assert.Equal(Path.Combine(expectedRoot, "mnemo.db"), MnemoAppPaths.GetLocalUserDataFile("mnemo.db"));
        Assert.Equal(Path.Combine(expectedRoot, "images"), MnemoAppPaths.GetImagesDirectory());
    }

    [Fact]
    public void GetLocalUserDataRoot_IgnoresOverride_WhenWhitespace()
    {
        string defaultRoot;
        using (new DataDirOverrideScope(null))
        {
            defaultRoot = MnemoAppPaths.GetLocalUserDataRoot();
        }

        using var scope = new DataDirOverrideScope("   ");
        Assert.Equal(defaultRoot, MnemoAppPaths.GetLocalUserDataRoot());
    }

    [Fact]
    public void GetLocalUserDataRoot_EndsWithProductFolder_WhenOverrideUnset()
    {
        using var scope = new DataDirOverrideScope(null);
        Assert.Equal("Mnemo", Path.GetFileName(MnemoAppPaths.GetLocalUserDataRoot()));
    }

    /// <summary>
    /// Sets the data-dir override for the duration of a test and restores the
    /// previous value on dispose, so the process-wide variable never leaks
    /// between tests.
    /// </summary>
    private sealed class DataDirOverrideScope : IDisposable
    {
        private readonly string? _previous;

        public DataDirOverrideScope(string? value)
        {
            _previous = Environment.GetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable);
            Environment.SetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable, value);
        }

        public void Dispose()
            => Environment.SetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable, _previous);
    }
}
