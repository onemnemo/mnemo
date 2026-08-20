using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// Releases the pooled connections one database file is holding, so the file can be edited by
/// hand or deleted, without touching any other database in the process.
/// </summary>
/// <remarks>
/// <para>
/// The obvious call here is <c>SqliteConnection.ClearAllPools()</c>, and it is the wrong one.
/// It is process global: it walks every pool group in the process, calls <c>DoNotPool</c> on
/// every connection each pool is tracking (checked-out ones included) and then disposes the
/// native <c>sqlite3</c> handle of any connection whose owning <c>SqliteConnection</c> the GC
/// has already collected. Under xUnit's default parallel collections that reaches straight into
/// databases this test never heard of, and the collection reading one of them fails with
/// "Cannot access a disposed object. Object name: 'SQLitePCL.sqlite3'" from
/// <c>SqliteCommand.PrepareAndEnumerateStatements</c>: a different test each run, every one of
/// them green in isolation.
/// </para>
/// <para>
/// <c>SqliteConnection.ClearPool</c> clears the pool group for one connection string and nothing
/// else, which is all any caller here ever wanted. The connection is never opened; constructing
/// it is enough to resolve the pool group the string belongs to.
/// </para>
/// </remarks>
internal static class SqliteTestPools
{
    /// <summary>
    /// Clears the pool for <paramref name="databasePath"/>, matching the connection string the
    /// stores build (<c>Data Source={path}</c>). A path opened under different options belongs to
    /// a different pool group and is unaffected.
    /// </summary>
    public static void ClearPoolFor(string databasePath)
    {
        using var connection = new SqliteConnection($"Data Source={databasePath}");
        SqliteConnection.ClearPool(connection);
    }
}
