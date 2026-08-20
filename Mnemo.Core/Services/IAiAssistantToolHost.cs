using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.Core.Services;

/// <summary>
/// Registers module AI tools and loads skill manifests only while <c>AI.EnableAssistant</c> is enabled.
/// </summary>
public interface IAiAssistantToolHost
{
    /// <summary>Settings key that gates tool and skill loading.</summary>
    const string EnabledSettingKey = "AI.EnableAssistant";

    bool IsLoaded { get; }

    Task EnsureLoadedAsync(CancellationToken cancellationToken = default);

    void Unload();
}
