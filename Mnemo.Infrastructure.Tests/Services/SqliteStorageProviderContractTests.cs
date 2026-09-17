using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Mnemo.Infrastructure.Services;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Services;

/// <summary>
/// The read contract every consumer of <c>IStorageProvider</c> leans on: a key that is not stored
/// is a failure with no exception, and a store that could not answer attaches the one that
/// stopped it. Consumers tell "nothing there" from "could not read" on exactly that split, so a
/// test double has to keep it too.
/// </summary>
public sealed class SqliteStorageProviderContractTests
{
    [Fact]
    public async Task An_absent_key_is_a_failure_carrying_no_exception()
    {
        var path = TempDatabasePath();
        try
        {
            var provider = new SqliteStorageProvider(new TestLogger(), path);

            var result = await provider.LoadAsync<List<string>>("never_written");

            Assert.False(result.IsSuccess);
            Assert.Null(result.Exception);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task A_value_that_cannot_be_read_is_a_failure_carrying_the_exception()
    {
        var path = TempDatabasePath();
        try
        {
            var provider = new SqliteStorageProvider(new TestLogger(), path);
            Assert.True((await provider.SaveAsync("shape", "a string, not a list")).IsSuccess);

            var result = await provider.LoadAsync<List<string>>("shape");

            Assert.False(result.IsSuccess);
            Assert.NotNull(result.Exception);
        }
        finally
        {
            Delete(path);
        }
    }

    private static string TempDatabasePath() =>
        Path.Combine(Path.GetTempPath(), $"mnemo_storage_{Guid.NewGuid():N}.db");

    private static void Delete(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (IOException)
        {
            // A handle the pool has not released yet; the temp directory is cleaned on its own.
        }
    }
}
