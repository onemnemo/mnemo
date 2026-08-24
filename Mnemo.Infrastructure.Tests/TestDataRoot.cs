using System.Runtime.CompilerServices;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Owns the data root for this test assembly. The root is pointed at a temporary directory before
/// the first test runs, so a service that resolves <see cref="MnemoAppPaths"/> for itself lands
/// there rather than in the profile the installed app reads. Nothing repoints it afterwards, so a
/// test never has to race a neighbour for it.
/// </summary>
public static class TestDataRoot
{
    private static readonly string InstalledRoot =
        MnemoAppPaths.ResolveDataRoot(null, MnemoAppPaths.GetLocalApplicationData());

    private static readonly HashSet<string> EntriesBeforeTheRun = ReadInstalledEntries();

    /// <summary>The temporary data root this assembly's tests own for the length of the run.</summary>
    public static string Root { get; } =
        Path.Combine(Path.GetTempPath(), "mnemo-tests", $"infrastructure-{Guid.NewGuid():N}");

    /// <summary>
    /// Where an installed app keeps its profile on this machine, whatever root is currently in
    /// force. This is the directory a test run must leave exactly as it found it.
    /// </summary>
    public static string InstalledProfileRoot => InstalledRoot;

    /// <summary>
    /// Paths under <see cref="InstalledProfileRoot"/> that were not there when the run started.
    /// Empty is the only correct answer. Empty as well when this machine has no installed profile.
    /// </summary>
    public static IReadOnlyList<string> FindInstalledProfileAdditions()
    {
        var current = ReadInstalledEntries();
        current.ExceptWith(EntriesBeforeTheRun);
        return [.. current.Order(StringComparer.Ordinal)];
    }

    [ModuleInitializer]
    internal static void Install()
    {
        Directory.CreateDirectory(Root);
        Environment.SetEnvironmentVariable(MnemoAppPaths.DataDirEnvironmentVariable, Root);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => Remove();
    }

    private static HashSet<string> ReadInstalledEntries()
    {
        if (!Directory.Exists(InstalledRoot))
            return new HashSet<string>(StringComparer.Ordinal);

        return new HashSet<string>(
            Directory.EnumerateFileSystemEntries(InstalledRoot, "*", SearchOption.AllDirectories),
            StringComparer.Ordinal);
    }

    private static void Remove()
    {
        try
        {
            if (Directory.Exists(Root))
                Directory.Delete(Root, recursive: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // The results are already reported by the time this runs, so throwing would only take
            // the runner down after the fact. Say what was left behind instead.
            Console.Error.WriteLine($"Could not remove the test data root at {Root}: {ex.Message}");
        }
    }
}
