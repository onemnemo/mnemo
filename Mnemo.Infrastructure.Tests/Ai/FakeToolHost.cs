using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>Tool host double that records how often it was asked to load and reflects a loaded flag.</summary>
internal sealed class FakeToolHost : IAiAssistantToolHost
{
    public int EnsureLoadedCallCount { get; private set; }

    public bool IsLoaded { get; private set; }

    public Task EnsureLoadedAsync(CancellationToken cancellationToken = default)
    {
        EnsureLoadedCallCount++;
        IsLoaded = true;
        return Task.CompletedTask;
    }

    public void Unload() => IsLoaded = false;
}
