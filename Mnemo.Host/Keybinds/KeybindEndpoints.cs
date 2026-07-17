using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Keybinds;

/// <summary>
/// Exposes the keybind catalog the SPA's keymap layer loads. The server owns the
/// definitions (module manifests) and user overrides via <see cref="IKeyMap"/>;
/// the browser owns matching and dispatch.
/// </summary>
public static class KeybindEndpoints
{
    public static void MapKeybinds(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/keybinds", async (IKeyMap keyMap, CancellationToken cancellationToken) =>
        {
            // Guarantee user overrides are merged even on the first request (the
            // service loads them off-thread at startup); this also refreshes them.
            await keyMap.ReloadOverridesAsync(cancellationToken).ConfigureAwait(false);
            return keyMap.GetAllStaticDefinitionsMerged().Select(KeybindDto.FromDefinition).ToList();
        });
    }
}
