using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Holds the rule that a test run writes nothing into the profile an installed app reads. The
/// first test keeps every path accessor pointed inside the directory this assembly owns, which is
/// what makes a stray write impossible rather than merely unlikely; the second catches a write
/// that reached the profile by some path that never asked <see cref="MnemoAppPaths"/>. Sits in the
/// collection that owns data root changes, so it never samples the root while another test is
/// holding it somewhere else.
/// </summary>
[Collection(DataRootCollection.Name)]
public sealed class DataRootIsolationTests
{
    [Fact]
    public void The_data_root_resolves_inside_the_directory_this_assembly_owns()
    {
        Assert.Equal(TestDataRoot.Root, MnemoAppPaths.GetLocalUserDataRoot());
        Assert.StartsWith(TestDataRoot.Root, MnemoAppPaths.GetImagesDirectory(), StringComparison.Ordinal);
        Assert.StartsWith(TestDataRoot.Root, MnemoAppPaths.GetLogsDirectory(), StringComparison.Ordinal);
    }

    [Fact]
    public void The_installed_profile_gains_nothing_while_the_suite_runs()
    {
        var additions = TestDataRoot.FindInstalledProfileAdditions();

        Assert.True(
            additions.Count == 0,
            $"A test wrote into the profile an installed app reads ({TestDataRoot.InstalledProfileRoot}). "
                + "Give the code under test a directory the test owns instead of letting it resolve "
                + "the data root for itself:"
                + Environment.NewLine
                + string.Join(Environment.NewLine, additions));
    }
}
