using System.Collections.Generic;
using System.Text.Json;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A snapshot of the settings the SPA renders rows for.
/// <para>
/// <see cref="Values"/> holds the raw stored JSON per key — a boolean or a string,
/// matching what the desktop wrote. Keys with nothing stored are absent, so the SPA
/// applies its own schema default rather than guessing one server-side.
/// </para>
/// <para>
/// Secrets never appear in <see cref="Values"/>. <see cref="Secrets"/> reports only
/// whether each one currently has a value, which is enough to render a "saved" state.
/// </para>
/// </summary>
public sealed record SettingsValuesDto(
    IReadOnlyDictionary<string, JsonElement> Values,
    IReadOnlyDictionary<string, bool> Secrets);

/// <summary>
/// Body of <c>PUT /api/settings/values/{key}</c>. The JSON kind must match the kind
/// the key is registered with; writing a secret an empty string clears it.
/// </summary>
public sealed record SettingValueDto(JsonElement Value);
