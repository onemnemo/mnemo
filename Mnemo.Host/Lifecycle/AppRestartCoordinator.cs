using Mnemo.Core.Services;
using Photino.NET;

namespace Mnemo.Host.Lifecycle;

public sealed class AppRestartCoordinator
{
    private const string LogCategory = "AppRestart";
    private static readonly TimeSpan ResponseGrace = TimeSpan.FromMilliseconds(150);
    private readonly ILoggerService _logger;
    private PhotinoWindow? _window;
    private int _requested;

    public AppRestartCoordinator(ILoggerService logger)
    {
        _logger = logger;
    }

    public bool Available => _window is not null;
    public bool Requested => Volatile.Read(ref _requested) == 1;

    public void Attach(PhotinoWindow window) => _window = window;

    public bool Request()
    {
        var window = _window;
        if (window is null || Interlocked.Exchange(ref _requested, 1) == 1)
            return false;

        _ = Task.Run(async () =>
        {
            // The restart request is a loopback HTTP call. Let its response reach the renderer
            // before closing so a refusal and a successful handoff remain distinguishable.
            await Task.Delay(ResponseGrace).ConfigureAwait(false);
            try
            {
                window.Invoke(window.Close);
            }
            catch (Exception ex)
            {
                Interlocked.Exchange(ref _requested, 0);
                _logger.Error(LogCategory, "The application window could not close for restart.", ex);
            }
        });
        return true;
    }

    public bool CancelRequest() => Interlocked.Exchange(ref _requested, 0) == 1;
}
