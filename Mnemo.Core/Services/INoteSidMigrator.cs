using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Core.Services;

/// <summary>
/// Backfills the short identifiers and version counter that the note contract is built on, over
/// every note already in a user's database.
///
/// Nothing may read or write a note until this reports complete. That is stricter than it needs to
/// be for reads, and deliberately so: a partially migrated corpus is one where some blocks can be
/// addressed by sid and some cannot, and every caller downstream would need its own answer for the
/// second case.
/// </summary>
public interface INoteSidMigrator
{
    /// <summary>
    /// True once every note carries a valid sid and version and the whole corpus has been
    /// revalidated. False before the migration runs, and false if it ran and failed. A failed
    /// migration leaves notes closed rather than exposing a half-migrated corpus.
    /// </summary>
    bool IsComplete { get; }

    /// <summary>
    /// Runs the migration if it has not already completed. Safe to call repeatedly and safe to
    /// resume after an interruption at any point.
    /// </summary>
    Task MigrateAsync(CancellationToken cancellationToken = default);
}
