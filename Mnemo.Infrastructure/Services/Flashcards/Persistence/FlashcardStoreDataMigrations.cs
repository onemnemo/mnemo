using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// What a data migration step is handed: the writer connection and the transaction the whole
/// upgrade runs in, plus the clock, so a step never reads the wall clock itself.
/// </summary>
internal sealed record FlashcardMigrationContext(
    SqliteConnection Connection,
    SqliteTransaction Transaction,
    TimeProvider Time,
    CancellationToken CancellationToken)
{
    /// <summary>A command already enrolled in the upgrade transaction.</summary>
    public SqliteCommand CreateCommand()
    {
        var command = Connection.CreateCommand();
        command.Transaction = Transaction;
        return command;
    }
}

/// <summary>
/// Migrations that move data rather than add a column, in ascending version order.
/// </summary>
/// <remarks>
/// Adding a column is idempotent and can be reapplied blindly, which is why
/// <see cref="FlashcardStoreSchema.AddedColumns"/> needs no version of its own. Moving data
/// cannot, so each step here names the version it takes the database to and runs only for a
/// database below it. A step is also written to be safe to rerun, because the version stamp and
/// the work land in one transaction and a machine can lose power between the two.
/// </remarks>
internal static class FlashcardStoreDataMigrations
{
    internal sealed record Step(int Version, Func<FlashcardMigrationContext, Task> ApplyAsync);

    public static readonly Step[] Steps =
    [
        new(6, FlashcardFactBackfill.ApplyAsync),
        new(9, FlashcardFactDeckHeal.ApplyAsync),
    ];
}
