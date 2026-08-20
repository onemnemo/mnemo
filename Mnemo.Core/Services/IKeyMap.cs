using Mnemo.Core.Models.Keybinds;

namespace Mnemo.Core.Services;

/// <summary>Central keybind registry: matching only; execution is the UI keybind action router.</summary>
public interface IKeyMap
{
    /// <summary>Fired after override storage is reloaded and merged definitions change.</summary>
    event EventHandler? MergedDefinitionsChanged;

    /// <summary>Replace built-in manifest table (from bootstrap). Does not clear overrides.</summary>
    void ReplaceManifestDefinitions(IReadOnlyList<KeybindActionDefinition> definitions);

    /// <summary>Clears previous ephemeral bindings and registers new ones for the active route.</summary>
    void ReplaceEphemeralDefinitions(IReadOnlyList<KeybindActionDefinition> definitions);

    void SetActiveRoute(string? route, string? activeNamespace);

    void PushSuppression(string scope, KeybindSuppressionPolicy? policy);
    void PopSuppression(string scope);

    /// <summary>
    /// Rich text / editor capture: while depth &gt; 0, most global shortcuts are not matched (typing safety).
    /// Actions with <see cref="KeybindActionDefinition.AllowedDuringTextCapture"/> still match.
    /// </summary>
    void EnterTextCapture();
    void LeaveTextCapture();

    KeybindTunnelResult ProcessGlobalKeyDown(KeybindPhysicalInput input, DateTime utcNow, SequenceSwallowMode swallowMode);
    KeybindBubbleResult ProcessLocalKeyDown(KeybindPhysicalInput input, DateTime utcNow, SequenceSwallowMode swallowMode);

    void ResetSequences(KeybindSequenceScope scope);
    void OnNavigationChanged();

    /// <summary>
    /// Enabled globals + locals for active namespace + ephemeral, merged with overrides, before suppression.
    /// Used for matching and context-specific UI.
    /// </summary>
    IReadOnlyList<KeybindActionDefinition> GetStaticArmedDefinitions();

    IReadOnlyList<KeybindConflict> CheckConflictsStaticArmed();

    /// <summary>
    /// All manifest and ephemeral actions merged with user overrides. Disabled actions remain listed
    /// (<see cref="KeybindActionDefinition.Enabled"/> false) so UI can show an inactive state. Locals for every
    /// namespace, not filtered by <see cref="SetActiveRoute"/>. Use for the keybind manager / quick-actions catalog.
    /// </summary>
    IReadOnlyList<KeybindActionDefinition> GetAllStaticDefinitionsMerged();

    /// <summary>Chord/sequence conflicts across <see cref="GetAllStaticDefinitionsMerged"/>.</summary>
    IReadOnlyList<KeybindConflict> CheckConflictsAllStatic();

    Task ReloadOverridesAsync(CancellationToken cancellationToken = default);

    /// <summary>Apply user override document for one action (from overlay).</summary>
    Task ApplyUserOverrideAsync(string actionId, KeybindOverrideDocument? document, CancellationToken cancellationToken = default);

    Task ResetAllOverridesAsync(CancellationToken cancellationToken = default);
}
