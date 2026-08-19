using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Host.Trash;

/// <summary>
/// The background half of the trash: reconciliation at startup, expiry on a timer, and the two
/// passes an operation can ask for after an uncertain outcome.
/// </summary>
/// <remarks>
/// The loop is started after Kestrel is listening, so nothing here delays the window opening, and
/// trash routes stay closed until the first reconciliation finishes.
/// </remarks>
public sealed class TrashMaintenance : ITrashMaintenance, IDisposable
{
    private static readonly TimeSpan ExpiryInterval = TimeSpan.FromHours(1);

    private readonly IServiceProvider _services;
    private readonly ILoggerService _logger;
    private readonly CancellationTokenSource _stopping = new();
    private readonly SemaphoreSlim _wake = new(0);
    private readonly object _startLock = new();

    private int _reconcileRequested;
    private int _cleanupRequested;
    private int _disposed;
    private Task? _loop;

    /// <param name="services">
    /// Resolved from, rather than injected, because the coordinator this drives is also the thing
    /// that asks it for a pass, and constructor injection both ways cannot be built.
    /// </param>
    /// <param name="logger">Where background failures are reported.</param>
    public TrashMaintenance(IServiceProvider services, ILoggerService logger)
    {
        _services = services;
        _logger = logger;
    }

    /// <summary>Whether the first reconciliation pass has finished, successfully or not.</summary>
    public bool IsReady { get; private set; }

    /// <summary>Starts the loop. Calling it more than once does nothing.</summary>
    public void StartInBackground()
    {
        lock (_startLock)
        {
            _loop ??= Task.Run(RunAsync);
        }
    }

    /// <inheritdoc />
    public void RequestReconciliation()
    {
        Interlocked.Exchange(ref _reconcileRequested, 1);
        Wake();
    }

    /// <inheritdoc />
    public void RequestAssetCleanup()
    {
        Interlocked.Exchange(ref _cleanupRequested, 1);
        Wake();
    }

    /// <summary>
    /// Stops the loop. Safe to call more than once, which the container does: this is registered
    /// both under its own type and behind the interface the coordinator asks through.
    /// </summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 1)
            return;

        _stopping.Cancel();
        _stopping.Dispose();
        _wake.Dispose();
    }

    private void Wake()
    {
        // An extra token only costs one more pass around the loop; a missed one costs nothing
        // either, because the request flags are what the loop actually reads.
        if (_wake.CurrentCount == 0)
        {
            try
            {
                _wake.Release();
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }

    private async Task RunAsync()
    {
        var stopping = _stopping.Token;

        try
        {
            await ReconcileAsync(stopping).ConfigureAwait(false);
        }
        finally
        {
            // Even a failed pass opens the trash. A person locked out of their own recoverable
            // content is worse than a listing that a later pass tidies.
            IsReady = true;
        }

        await SweepAsync(stopping).ConfigureAwait(false);
        await CleanAsync(stopping).ConfigureAwait(false);

        while (!stopping.IsCancellationRequested)
        {
            bool woken;
            try
            {
                woken = await _wake.WaitAsync(ExpiryInterval, stopping).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }

            if (stopping.IsCancellationRequested)
                return;

            if (Interlocked.Exchange(ref _reconcileRequested, 0) == 1)
                await ReconcileAsync(stopping).ConfigureAwait(false);

            if (Interlocked.Exchange(ref _cleanupRequested, 0) == 1)
                await CleanAsync(stopping).ConfigureAwait(false);

            // Nothing asked for expiry; the hour simply came around.
            if (!woken)
            {
                await SweepAsync(stopping).ConfigureAwait(false);
                await CleanAsync(stopping).ConfigureAwait(false);
            }
        }
    }

    private async Task ReconcileAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _services.GetRequiredService<ITrashService>()
                .ReconcileAsync(cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger.Error("Trash", "Reconciling the trash failed.", ex);
        }
    }

    private async Task SweepAsync(CancellationToken cancellationToken)
    {
        try
        {
            var purged = await _services.GetRequiredService<ITrashService>()
                .SweepExpiredAsync(cancellationToken)
                .ConfigureAwait(false);
            if (purged > 0)
                _logger.Info("Trash", $"Destroyed {purged} expired trash entries.");
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger.Error("Trash", "Sweeping expired trash entries failed.", ex);
        }
    }

    private async Task CleanAsync(CancellationToken cancellationToken)
    {
        try
        {
            var deleted = await _services.GetRequiredService<AssetCleanupWorker>()
                .RunAsync(cancellationToken)
                .ConfigureAwait(false);
            if (deleted > 0)
                _logger.Info("Trash", $"Removed {deleted} files left by permanent deletion.");
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger.Error("Trash", "Removing files left by permanent deletion failed.", ex);
        }
    }
}
