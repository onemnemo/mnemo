using Microsoft.Data.Sqlite;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Owns the flashcard database: connection, DDL, schema migration, the single-writer queue and
/// transaction coordination. All multi-table writes go through <see cref="WriteAsync"/> so they
/// commit atomically; reads run concurrently through <see cref="ReadAsync"/> (WAL allows it).
/// Repositories never own a connection — the store hands them one (plus a transaction for writes).
/// </summary>
public interface IFlashcardStore
{
    /// <summary>Ensures the schema exists and is at the target version. Idempotent.</summary>
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs a read against a fresh pooled connection. Reads are not serialized; multiple may run
    /// concurrently under WAL.
    /// </summary>
    Task<T> ReadAsync<T>(Func<SqliteConnection, CancellationToken, Task<T>> read, CancellationToken cancellationToken = default);

    /// <summary>
    /// Runs a write inside a single transaction on the owned writer connection, serialized behind the
    /// single-writer queue. The delegate's repository calls all commit together or roll back together.
    /// </summary>
    Task WriteAsync(Func<SqliteConnection, SqliteTransaction, CancellationToken, Task> write, CancellationToken cancellationToken = default);

    /// <summary>Transactional write that returns a value (e.g. the created row).</summary>
    Task<T> WriteAsync<T>(Func<SqliteConnection, SqliteTransaction, CancellationToken, Task<T>> write, CancellationToken cancellationToken = default);
}
