using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Mnemo.Host.Lifecycle;

/// <summary>
/// Leaves process lifetime under the window message loop. The default host lifetime would cancel
/// the event stream before the window can request saves.
/// </summary>
internal sealed class WindowHostLifetime : IHostLifetime
{
    /// <summary>
    /// Takes the default hook out of the container before it is built, so it is never
    /// constructed and never registers a handler of its own.
    /// </summary>
    public static void Install(IServiceCollection services)
    {
        services.RemoveAll<IHostLifetime>();
        services.AddSingleton<IHostLifetime, WindowHostLifetime>();
    }

    /// <summary>Nothing to wait for: startup is finished when the server says it is.</summary>
    public Task WaitForStartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>Nothing to unwind: the window's close is what brings this process down.</summary>
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
