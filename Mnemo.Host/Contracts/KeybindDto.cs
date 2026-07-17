using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services.Keybinds;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One registered keybind action, merged with user overrides, for the SPA's keymap
/// layer. The browser owns matching and dispatch, so bindings travel as canonical
/// chord strings (e.g. <c>Primary+K</c>) it parses and matches against key events.
/// Disabled actions are still listed so the keybind manager can show an inactive row.
/// </summary>
public sealed record KeybindDto(
    string ActionId,
    string Namespace,
    string Scope,
    string? Module,
    bool Enabled,
    bool AllowedDuringTextCapture,
    bool ToggleOnRepeat,
    string? LabelKey,
    string? DescriptionKey,
    string? CategoryKey,
    IReadOnlyList<KeybindBindingDto> Bindings)
{
    public static KeybindDto FromDefinition(KeybindActionDefinition def) => new(
        def.ActionId,
        def.Namespace,
        def.Scope.ToString(),
        def.Module,
        def.Enabled,
        def.AllowedDuringTextCapture,
        def.ToggleOnRepeat,
        def.DisplayLabelKey,
        def.DisplayDescriptionKey,
        def.DisplayCategoryKey,
        def.Bindings.Select(KeybindBindingDto.FromEntry).ToList());
}

/// <summary>One alternative binding: a single chord or an ordered sequence of chords.</summary>
public sealed record KeybindBindingDto(string Kind, string? Chord, IReadOnlyList<string>? Sequence)
{
    public static KeybindBindingDto FromEntry(KeybindBindingEntry entry) => new(
        entry.Kind.ToString(),
        entry.Chord is { } chord ? CanonicalKeyGestureCodec.ToCanonicalString(chord) : null,
        entry.SequenceSteps?.Select(CanonicalKeyGestureCodec.ToCanonicalString).ToList());
}
