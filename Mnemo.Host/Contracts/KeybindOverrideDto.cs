using System.Collections.Generic;

namespace Mnemo.Host.Contracts;

/// <summary>
/// Body of <c>PUT /api/keybinds/{actionId}</c>: the user's replacement bindings for one
/// action. Deliberately mirrors <see cref="KeybindBindingDto"/> rather than the storage
/// document's own field names, so the SPA reads and writes one binding shape.
/// </summary>
/// <param name="Enabled">False disables the action without unbinding it.</param>
/// <param name="Bindings">
/// The alternatives that replace the manifest defaults. An empty list unbinds the action.
/// </param>
public sealed record KeybindOverrideDto(bool Enabled, IReadOnlyList<KeybindBindingDto>? Bindings);
