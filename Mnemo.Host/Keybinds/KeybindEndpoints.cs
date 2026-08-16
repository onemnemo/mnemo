using System.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Keybinds;
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

        endpoints.MapPut("/api/keybinds/{actionId}", async (string actionId, KeybindOverrideDto body, IKeyMap keyMap, CancellationToken cancellationToken) =>
        {
            if (!keyMap.GetAllStaticDefinitionsMerged().Any(d => string.Equals(d.ActionId, actionId, StringComparison.Ordinal)))
                return Results.NotFound(new ErrorDto("unknown_action", $"'{actionId}' is not a registered keybind action."));

            await keyMap.ApplyUserOverrideAsync(actionId, ToDocument(body), cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapDelete("/api/keybinds/{actionId}", async (string actionId, IKeyMap keyMap, CancellationToken cancellationToken) =>
        {
            // A null document drops the override, restoring the manifest default.
            await keyMap.ApplyUserOverrideAsync(actionId, null, cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });

        endpoints.MapDelete("/api/keybinds", async (IKeyMap keyMap, CancellationToken cancellationToken) =>
        {
            await keyMap.ResetAllOverridesAsync(cancellationToken).ConfigureAwait(false);
            return Results.NoContent();
        });
    }

    /// <summary>
    /// Translates the wire binding shape into the storage document's own field names
    /// (<c>gesture</c>/<c>steps</c>). Bindings missing the payload their kind requires are
    /// dropped here rather than persisted as unparseable rows.
    /// </summary>
    private static KeybindOverrideDocument ToDocument(KeybindOverrideDto dto) => new()
    {
        Enabled = dto.Enabled,
        Bindings = (dto.Bindings ?? [])
            .Select(b => string.Equals(b.Kind, "Sequence", StringComparison.OrdinalIgnoreCase)
                ? new KeybindOverrideBindingDto { Kind = "sequence", Steps = b.Sequence?.ToList() }
                : new KeybindOverrideBindingDto { Kind = "chord", Gesture = b.Chord })
            .Where(b => b.Kind == "chord" ? !string.IsNullOrWhiteSpace(b.Gesture) : b.Steps is { Count: > 0 })
            .ToList(),
    };
}
