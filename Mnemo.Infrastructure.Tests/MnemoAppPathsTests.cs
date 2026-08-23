using System;
using System.IO;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Tests;

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

[Collection(DataRootCollection.Name)]
public sealed class MnemoAppPathsTests
{
    private static readonly string LocalAppData = Path.Combine(Path.GetTempPath(), "mnemo-local-app-data");

    [Fact]
    public void ResolveDataRoot_UsesTheOverride_WhenOneIsGiven()
    {
        var overrideRoot = Path.Combine(Path.GetTempPath(), "mnemo-data-override");

        Assert.Equal(
            Path.GetFullPath(overrideRoot),
            MnemoAppPaths.ResolveDataRoot(overrideRoot, LocalAppData));
    }

    [Fact]
    public void ResolveDataRoot_IgnoresTheOverride_WhenItIsBlank()
    {
        var withoutOverride = MnemoAppPaths.ResolveDataRoot(null, LocalAppData);

        Assert.Equal(withoutOverride, MnemoAppPaths.ResolveDataRoot("   ", LocalAppData));
        Assert.Equal(withoutOverride, MnemoAppPaths.ResolveDataRoot(string.Empty, LocalAppData));
    }

    [Fact]
    public void ResolveDataRoot_KeepsTheShippedLocation_WhenThereIsNoOverride()
    {
        // Spelled out rather than derived from the accessor: an installed app has no
        // override, and its profile has to stay at this exact path.
        Assert.Equal(Path.Combine(LocalAppData, "Mnemo"), MnemoAppPaths.ResolveDataRoot(null, LocalAppData));
    }

    [Fact]
    public void GetLocalUserDataRoot_FollowsTheEnvironmentVariable()
    {
        var inForce = Environment.GetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable);

        Assert.False(string.IsNullOrWhiteSpace(inForce));
        Assert.Equal(Path.GetFullPath(inForce!), MnemoAppPaths.GetLocalUserDataRoot());
    }

    [Fact]
    public void Every_accessor_sits_under_the_root_in_force()
    {
        var root = MnemoAppPaths.GetLocalUserDataRoot();

        Assert.Equal(Path.Combine(root, "mnemo.db"), MnemoAppPaths.GetLocalUserDataFile("mnemo.db"));
        Assert.Equal(Path.Combine(root, "images"), MnemoAppPaths.GetImagesDirectory());
        Assert.Equal(Path.Combine(root, "logs"), MnemoAppPaths.GetLogsDirectory());
        Assert.Equal(Path.Combine(root, "note-assets"), MnemoAppPaths.GetNoteAssetsDirectory());
        Assert.Equal(Path.Combine(root, "mindmap-assets"), MnemoAppPaths.GetMindmapAssetsDirectory());
        Assert.Equal(Path.Combine(root, "chat-attachments"), MnemoAppPaths.GetChatAttachmentsDirectory());
    }
}
