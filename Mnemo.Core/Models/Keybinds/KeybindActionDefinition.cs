namespace Mnemo.Core.Models.Keybinds;

/// <summary>Registered action with one or more chord/sequence alternatives.</summary>
public sealed class KeybindActionDefinition
{
    public required string ActionId { get; init; }
    public required string Namespace { get; init; }
    public KeybindScope Scope { get; init; }
    /// <summary>When true, overlay may show that this binding suppresses globals in its UI context.</summary>
    public bool SuppressesGlobalsInContext { get; init; }

    /// <summary>
    /// When true, a <see cref="KeybindScope.Global"/> action still matches while rich-text
    /// <c>EnterTextCapture</c> depth is &gt; 0 (e.g. global search from an editor).
    /// </summary>
    public bool AllowedDuringTextCapture { get; init; }
    public IReadOnlyList<KeybindBindingEntry> Bindings { get; init; } = Array.Empty<KeybindBindingEntry>();
    public IReadOnlyList<string> ObsoleteIds { get; init; } = Array.Empty<string>();
    /// <summary>When false, bindings are ignored for matching but may still be listed for UI (e.g. user-disabled globals).</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>
    /// When true, a <see cref="KeybindScope.Global"/> action may dismiss its UI target if it is already open
    /// (e.g. same shortcut closes the global search overlay). Handlers decide what counts as &quot;open&quot;.
    /// </summary>
    public bool ToggleOnRepeat { get; init; }

    /// <summary>Owning product area for UI grouping (e.g. <c>core</c>, <c>editor</c>, <c>mindmap</c>, <c>flashcards</c>).</summary>
    public string? Module { get; init; }

    /// <summary>Localization key under the <c>Keybinds</c> namespace for the short title (falls back to <see cref="ActionId"/>).</summary>
    public string? DisplayLabelKey { get; init; }

    /// <summary>Optional localization key under <c>Keybinds</c> for a longer description.</summary>
    public string? DisplayDescriptionKey { get; init; }

    /// <summary>Localization key under <c>Keybinds</c> for the category line (e.g. <c>category.formatting</c>).</summary>
    public string? DisplayCategoryKey { get; init; }

    /// <summary>
    /// True when a user override is standing in for the manifest's own bindings.
    /// </summary>
    /// <remarks>
    /// Set only by the merge; a manifest definition is never overridden by definition.
    /// It is what lets a shortcuts UI offer "reset" on the rows that have somewhere to
    /// reset to, rather than on every row whether or not it has moved.
    /// </remarks>
    public bool IsOverridden { get; init; }
}
