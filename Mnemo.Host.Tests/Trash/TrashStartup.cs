using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Host.Tests.Trash;

/// <summary>Opens the trash the way the HTTP harnesses need it before their first request.</summary>
internal static class TrashStartup
{
    /// <summary>
    /// Creates the trash schema and opens its first reader, then starts the loop and waits for the
    /// first reconciliation pass.
    /// </summary>
    /// <remarks>
    /// The app creates the trash schema lazily inside the first pass. Here it is built beforehand,
    /// because creating a fresh database can take tens of seconds on a saturated disk, and the
    /// deadline is meant to measure the pass, so it still catches a stuck one.
    /// </remarks>
    public static async Task StartAsync(TrashMaintenance maintenance, TrashDatabase database)
    {
        await database.InitializeAsync().ConfigureAwait(false);
        await database.CountAsync("SELECT COUNT(*) FROM sqlite_master;", null, CancellationToken.None).ConfigureAwait(false);

        maintenance.StartInBackground();

        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!maintenance.IsReady)
        {
            if (DateTime.UtcNow > deadline)
                throw new TimeoutException("The trash never finished starting.");
            await Task.Delay(10).ConfigureAwait(false);
        }
    }
}
