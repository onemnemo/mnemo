using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Nothing in this repository clears SQLite connection pools process wide.
/// </summary>
/// <remarks>
/// <para>
/// The call this forbids walks every pool group in the process, marks every connection each pool
/// tracks as unpoolable (the ones currently checked out included) and disposes the native
/// <c>sqlite3</c> handle of any connection whose owning <c>SqliteConnection</c> the GC has
/// already collected. A caller only ever wants that for the one database file it owns, and doing
/// it process wide reaches into every other database open at that moment. Under xUnit's default
/// parallel collections that means a different test failing each run with "Cannot access a
/// disposed object. Object name: 'SQLitePCL.sqlite3'", each of them green in isolation, which is
/// exactly what this suite did before the call sites were scoped.
/// </para>
/// <para>
/// The two supported replacements: open the connection with <c>Pooling=False</c> when the
/// database is a throwaway this caller owns end to end, or clear the pool for that one connection
/// string (<see cref="SqliteTestPools.ClearPoolFor"/> in tests, <c>SqliteConnection.ClearPool</c>
/// elsewhere) when a store under test opened it pooled.
/// </para>
/// <para>
/// This scans source rather than listing known call sites, so a new one is caught the day it is
/// written, in product code and test code alike.
/// </para>
/// </remarks>
public class SqlitePoolScopeTests
{
    /// <summary>Every first-party C# project. A project added later belongs in this list.</summary>
    private static readonly string[] ScannedProjects =
    [
        "Mnemo.Core",
        "Mnemo.Infrastructure",
        "Mnemo.Infrastructure.Tests",
        "Mnemo.Host",
        "Mnemo.Host.Tests",
        "Mnemo.SpanFixtureGen"
    ];

    // The escapes are what keep this line from matching itself when the scan reads this file:
    // a pattern spelled without them would report its own declaration as an offender.
    private static readonly Regex ProcessWideClear = new(
        @"SqliteConnection\s*\.\s*ClearAllPools\s*\(",
        RegexOptions.Compiled);

    [Fact]
    public void No_source_file_clears_every_sqlite_pool_in_the_process()
    {
        var root = RepositoryRoot();
        var offenders = new List<string>();
        var scanned = 0;

        foreach (var project in ScannedProjects)
        {
            var directory = Path.Combine(root, project);
            Assert.True(Directory.Exists(directory), $"Expected a project directory at {directory}.");

            foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
            {
                // Generated output under obj/ and bin/ is not source anyone edits.
                if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                    || file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                {
                    continue;
                }

                scanned++;
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    if (ProcessWideClear.IsMatch(WithoutLineComment(lines[i])))
                        offenders.Add($"{Path.GetRelativePath(root, file)}({i + 1})");
                }
            }
        }

        // A scan that read nothing found a broken path, not a clean repository.
        Assert.True(scanned > 900, $"Expected to scan the whole repository, read only {scanned} files.");

        Assert.True(
            offenders.Count == 0,
            "Clear the pool for one connection string instead, or open the database with Pooling=False:"
            + Environment.NewLine + string.Join(Environment.NewLine, offenders));
    }

    /// <summary>
    /// Drops a line comment, so prose naming the forbidden call (this file's own remarks, the
    /// comments at the sites that explain why pooling is off there) is not read as a call to it.
    /// Block comments are not stripped; nothing in this repository documents the call inside one.
    /// </summary>
    private static string WithoutLineComment(string line)
    {
        var marker = line.IndexOf("//", StringComparison.Ordinal);
        return marker < 0 ? line : line[..marker];
    }

    /// <summary>
    /// The repository root, found relative to this file's own path rather than the working
    /// directory or the test's output folder, so a scratch OutDir used for a test run does not
    /// change where the scan looks.
    /// </summary>
    private static string RepositoryRoot([CallerFilePath] string here = "")
    {
        // <root>/Mnemo.Infrastructure.Tests/SqlitePoolScopeTests.cs
        var project = new DirectoryInfo(Path.GetDirectoryName(here)!);
        return project.Parent!.FullName;
    }
}
