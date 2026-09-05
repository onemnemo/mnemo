using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Core.Services;

/// <summary>
/// Registers module AI tools and loads skill manifests only while the assistant is
/// available, which <see cref="AiAvailability"/> defines.
/// </summary>
public interface IAiAssistantToolHost
{
    bool IsLoaded { get; }

    Task EnsureLoadedAsync(CancellationToken cancellationToken = default);

    void Unload();
}
