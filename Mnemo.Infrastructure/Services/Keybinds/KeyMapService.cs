using System.Diagnostics;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;

namespace Mnemo.Infrastructure.Services.Keybinds;

public sealed class KeyMapService : IKeyMap
{
    public event EventHandler? MergedDefinitionsChanged;

    private const double DefaultSequenceTimeoutSeconds = 1.5;
    private readonly IKeybindRepository _repository;
    private readonly ILoggerService _logger;
    private readonly object _lock = new();

    private Dictionary<string, KeybindActionDefinition> _manifest = new(StringComparer.Ordinal);
    private Dictionary<string, KeybindActionDefinition> _ephemeral = new(StringComparer.Ordinal);
    private Dictionary<string, KeybindOverrideDocument> _overrides = new(StringComparer.Ordinal);

    private string? _activeRoute;
    private string? _activeNamespace;

    private readonly List<(string Scope, KeybindSuppressionPolicy? Policy)> _suppression = new();
    private int _textCaptureDepth;

    private List<SequenceCandidate>? _globalSeqCandidates;
    private DateTime _globalSeqStartedUtc;
    private List<SequenceCandidate>? _localSeqCandidates;
    private DateTime _localSeqStartedUtc;

    // Armed-defs cache, partitioned. Null = invalid. Rebuilt on demand under _lock.
    // Invalidated by any mutation to _manifest, _ephemeral, _overrides, or _activeNamespace.
    private List<KeybindActionDefinition>? _armedGlobalCache;
    private List<KeybindActionDefinition>? _armedLocalCache;

    [DebuggerDisplay("{ActionId} depth {Depth}")]
    private sealed class SequenceCandidate
    {
        public required string ActionId { get; init; }
        public required LogicalChord[] Steps { get; init; }
        public int Depth { get; set; }
    }

    public KeyMapService(IKeybindRepository repository, ILoggerService logger, IEnumerable<KeybindActionDefinition> bootstrapManifest)
    {
        _repository = repository;
        _logger = logger;
        ReplaceManifestDefinitions(bootstrapManifest.ToList());
        // Don't block the constructing thread (Bootstrapper.Build runs on the UI thread).
        // The repository may hit SQLite/disk; load overrides off-thread and merge in via the
        // existing lock. The window between ctor and first keystroke makes the gap invisible
        // in practice; any user override that lands after the first key event uses the cache
        // invalidation in ReloadOverridesAsync.
        _ = Task.Run(async () =>
        {
            try { await ReloadOverridesAsync().ConfigureAwait(false); }
            catch (Exception ex) { _logger.Error("Keybinds", $"Initial override load failed: {ex.Message}"); }
        });
    }

    private void InvalidateArmedCacheUnlocked()
    {
        _armedGlobalCache = null;
        _armedLocalCache = null;
    }

    public void ReplaceManifestDefinitions(IReadOnlyList<KeybindActionDefinition> definitions)
    {
        lock (_lock)
        {
            _manifest = definitions.ToDictionary(d => d.ActionId, StringComparer.Ordinal);
            InvalidateArmedCacheUnlocked();
            _logger.Debug("Keybinds", $"Manifest replaced: {_manifest.Count} actions.");
        }
    }

    public void ReplaceEphemeralDefinitions(IReadOnlyList<KeybindActionDefinition> definitions)
    {
        lock (_lock)
        {
            _ephemeral = new Dictionary<string, KeybindActionDefinition>(StringComparer.Ordinal);
            foreach (var d in definitions)
            {
                if (_manifest.ContainsKey(d.ActionId))
                {
#if DEBUG
                    throw new InvalidOperationException($"Ephemeral keybind '{d.ActionId}' duplicates manifest id.");
#else
                    _logger.Warning("Keybinds", $"Ignoring ephemeral keybind '{d.ActionId}' (manifest already defines it).");
                    continue;
#endif
                }

                if (!_ephemeral.TryAdd(d.ActionId, d))
                {
#if DEBUG
                    throw new InvalidOperationException($"Duplicate ephemeral keybind '{d.ActionId}'.");
#else
                    _logger.Warning("Keybinds", $"Duplicate ephemeral '{d.ActionId}' ignored.");
#endif
                }
            }
            InvalidateArmedCacheUnlocked();
        }
    }

    public void SetActiveRoute(string? route, string? activeNamespace)
    {
        lock (_lock)
        {
            var nsChanged = !string.Equals(_activeNamespace, activeNamespace, StringComparison.Ordinal);
            _activeRoute = route;
            _activeNamespace = activeNamespace;
            if (nsChanged)
                _armedLocalCache = null; // global bucket unaffected by namespace
            _logger.Debug("Keybinds", $"Active route '{route}', namespace '{activeNamespace}'.");
        }
    }

    public void PushSuppression(string scope, KeybindSuppressionPolicy? policy)
    {
        lock (_lock)
        {
            _suppression.Add((scope, policy));
            _logger.Debug("Keybinds", $"Suppression push '{scope}'.");
        }
    }

    public void PopSuppression(string scope)
    {
        lock (_lock)
        {
            for (var i = _suppression.Count - 1; i >= 0; i--)
            {
                if (string.Equals(_suppression[i].Scope, scope, StringComparison.Ordinal))
                {
                    _suppression.RemoveAt(i);
                    _logger.Debug("Keybinds", $"Suppression pop '{scope}'.");
                    return;
                }
            }
        }
    }

    public void EnterTextCapture()
    {
        lock (_lock)
        {
            _textCaptureDepth++;
            _logger.Debug("Keybinds", $"Text capture depth {_textCaptureDepth}.");
        }
    }

    public void LeaveTextCapture()
    {
        lock (_lock)
        {
            _textCaptureDepth = Math.Max(0, _textCaptureDepth - 1);
            _logger.Debug("Keybinds", $"Text capture depth {_textCaptureDepth}.");
        }
    }

    public void ResetSequences(KeybindSequenceScope scope)
    {
        lock (_lock)
        {
            if (scope == KeybindSequenceScope.Global)
                _globalSeqCandidates = null;
            else
                _localSeqCandidates = null;
        }
    }

    public void OnNavigationChanged()
    {
        lock (_lock)
        {
            _globalSeqCandidates = null;
            _localSeqCandidates = null;
            _ephemeral.Clear();
            InvalidateArmedCacheUnlocked();
        }
    }

    public KeybindTunnelResult ProcessGlobalKeyDown(KeybindPhysicalInput input, DateTime utcNow, SequenceSwallowMode swallowMode)
    {
        lock (_lock)
        {
            if (IsEscape(input))
            {
                _globalSeqCandidates = null;
                return KeybindTunnelResult.NoMatch();
            }

            TryExpireGlobalSequence(utcNow);

            var armed = EnsureGlobalArmedUnlocked();

            foreach (var def in armed)
            {
                foreach (var b in def.Bindings)
                {
                    if (b.Kind != KeybindBindingKind.Chord || b.Chord is not { } chord) continue;
                    if (!CanonicalKeyGestureCodec.ChordsMatch(chord, input)) continue;
                    if (IsGloballySuppressed(def))
                        continue;

                    _globalSeqCandidates = null;
                    return new KeybindTunnelResult(true, true, def.ActionId, false);
                }
            }

            var seqResult = TryProcessGlobalSequence(armed, input, utcNow, swallowMode);
            if (seqResult != null)
                return seqResult.Value;

            return KeybindTunnelResult.NoMatch();
        }
    }

    public KeybindBubbleResult ProcessLocalKeyDown(KeybindPhysicalInput input, DateTime utcNow, SequenceSwallowMode swallowMode)
    {
        lock (_lock)
        {
            if (IsEscape(input))
            {
                _localSeqCandidates = null;
                return KeybindBubbleResult.NoMatch();
            }

            TryExpireLocalSequence(utcNow);

            var armed = EnsureLocalArmedUnlocked();

            foreach (var def in armed)
            {
                foreach (var b in def.Bindings)
                {
                    if (b.Kind != KeybindBindingKind.Chord || b.Chord is not { } chord) continue;
                    if (!CanonicalKeyGestureCodec.ChordsMatch(chord, input)) continue;
                    _localSeqCandidates = null;
                    return new KeybindBubbleResult(true, true, def.ActionId, false);
                }
            }

            var seq = TryProcessLocalSequence(armed, input, utcNow, swallowMode);
            return seq ?? KeybindBubbleResult.NoMatch();
        }
    }

    public IReadOnlyList<KeybindActionDefinition> GetStaticArmedDefinitions()
    {
        lock (_lock)
            return GetStaticArmedDefinitionsUnlocked();
    }

    public IReadOnlyList<KeybindConflict> CheckConflictsStaticArmed() =>
        KeybindConflictAnalyzer.Analyze(GetStaticArmedDefinitions());

    public IReadOnlyList<KeybindActionDefinition> GetAllStaticDefinitionsMerged()
    {
        lock (_lock)
            return GetAllStaticDefinitionsMergedUnlocked();
    }

    public IReadOnlyList<KeybindConflict> CheckConflictsAllStatic() =>
        KeybindConflictAnalyzer.Analyze(GetAllStaticDefinitionsMerged());

    private IReadOnlyList<KeybindActionDefinition> GetAllStaticDefinitionsMergedUnlocked()
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var k in _manifest.Keys) ids.Add(k);
        foreach (var k in _ephemeral.Keys) ids.Add(k);

        var list = new List<KeybindActionDefinition>();
        foreach (var id in ids)
        {
            var merged = BuildMergedUnlocked(id);
            if (merged == null) continue;
            list.Add(merged);
        }

        return list;
    }

    public async Task ReloadOverridesAsync(CancellationToken cancellationToken = default)
    {
        var loaded = await _repository.LoadOverridesAsync(cancellationToken).ConfigureAwait(false);
        lock (_lock)
        {
            _overrides = loaded.ToDictionary(k => k.Key, v => v.Value, StringComparer.Ordinal);
            InvalidateArmedCacheUnlocked();
            _logger.Debug("Keybinds", $"Overrides loaded: {_overrides.Count} rows.");
        }

        MergedDefinitionsChanged?.Invoke(this, EventArgs.Empty);
    }

    public async Task ApplyUserOverrideAsync(string actionId, KeybindOverrideDocument? document, CancellationToken cancellationToken = default)
    {
        if (document == null)
            await _repository.DeleteOverrideAsync(actionId, cancellationToken).ConfigureAwait(false);
        else
            await _repository.SaveOverrideAsync(actionId, document, cancellationToken).ConfigureAwait(false);
        await ReloadOverridesAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task ResetAllOverridesAsync(CancellationToken cancellationToken = default)
    {
        await _repository.ClearAllOverridesAsync(cancellationToken).ConfigureAwait(false);
        await ReloadOverridesAsync(cancellationToken).ConfigureAwait(false);
    }

    private IReadOnlyList<KeybindActionDefinition> GetStaticArmedDefinitionsUnlocked()
    {
        var global = EnsureGlobalArmedUnlocked();
        var local = EnsureLocalArmedUnlocked();
        if (local.Count == 0) return global;
        if (global.Count == 0) return local;
        var list = new List<KeybindActionDefinition>(global.Count + local.Count);
        list.AddRange(global);
        list.AddRange(local);
        return list;
    }

    // Cached: armed Global definitions (Enabled=true). Independent of _activeNamespace.
    private List<KeybindActionDefinition> EnsureGlobalArmedUnlocked()
    {
        if (_armedGlobalCache != null) return _armedGlobalCache;

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var k in _manifest.Keys) ids.Add(k);
        foreach (var k in _ephemeral.Keys) ids.Add(k);

        var list = new List<KeybindActionDefinition>();
        foreach (var id in ids)
        {
            var merged = BuildMergedUnlocked(id);
            if (merged == null || !merged.Enabled) continue;
            if (merged.Scope == KeybindScope.Global)
                list.Add(merged);
        }
        return _armedGlobalCache = list;
    }

    // Cached: armed Local definitions for the current _activeNamespace.
    private List<KeybindActionDefinition> EnsureLocalArmedUnlocked()
    {
        if (_armedLocalCache != null) return _armedLocalCache;

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var k in _manifest.Keys) ids.Add(k);
        foreach (var k in _ephemeral.Keys) ids.Add(k);

        var list = new List<KeybindActionDefinition>();
        foreach (var id in ids)
        {
            var merged = BuildMergedUnlocked(id);
            if (merged == null || !merged.Enabled) continue;
            if (merged.Scope == KeybindScope.Local
                && string.Equals(merged.Namespace, _activeNamespace, StringComparison.Ordinal))
                list.Add(merged);
        }
        return _armedLocalCache = list;
    }

    private KeybindActionDefinition? BuildMergedUnlocked(string actionId)
    {
        if (!_manifest.TryGetValue(actionId, out var man) && !_ephemeral.TryGetValue(actionId, out man))
            return null;

        if (!_overrides.TryGetValue(actionId, out var ov))
            return man;

        if (!ov.Enabled)
        {
            return new KeybindActionDefinition
            {
                ActionId = actionId,
                Namespace = man.Namespace,
                Scope = man.Scope,
                Enabled = false,
                Bindings = man.Bindings,
                ObsoleteIds = man.ObsoleteIds,
                SuppressesGlobalsInContext = man.SuppressesGlobalsInContext,
                AllowedDuringTextCapture = man.AllowedDuringTextCapture,
                Module = man.Module,
                DisplayLabelKey = man.DisplayLabelKey,
                DisplayDescriptionKey = man.DisplayDescriptionKey,
                DisplayCategoryKey = man.DisplayCategoryKey,
                ToggleOnRepeat = man.ToggleOnRepeat,
                IsOverridden = true
            };
        }

        var parsed = KeybindOverrideParser.ParseBindings(ov);
        return new KeybindActionDefinition
        {
            ActionId = actionId,
            Namespace = man.Namespace,
            Scope = man.Scope,
            Enabled = true,
            Bindings = parsed.Count > 0 ? parsed : man.Bindings,
            ObsoleteIds = man.ObsoleteIds,
            SuppressesGlobalsInContext = man.SuppressesGlobalsInContext,
            AllowedDuringTextCapture = man.AllowedDuringTextCapture,
            Module = man.Module,
            DisplayLabelKey = man.DisplayLabelKey,
            DisplayDescriptionKey = man.DisplayDescriptionKey,
            DisplayCategoryKey = man.DisplayCategoryKey,
            ToggleOnRepeat = man.ToggleOnRepeat,
            IsOverridden = true
        };
    }

    private bool IsGloballySuppressed(KeybindActionDefinition def)
    {
        if (_textCaptureDepth > 0 && !def.AllowedDuringTextCapture)
            return true;

        foreach (var (_, policy) in _suppression)
        {
            if (policy == null) continue;
            if (policy.SuppressAll) return true;
            if (policy.OnlyActionIds != null && policy.OnlyActionIds.Contains(def.ActionId)) return true;
            if (policy.OnlyNamespaces != null && policy.OnlyNamespaces.Contains(def.Namespace)) return true;
        }

        return false;
    }

    private bool AllCandidatesSuppressed(IReadOnlyList<string> actionIds)
    {
        foreach (var id in actionIds)
        {
            var def = BuildMergedUnlocked(id);
            if (def == null) continue;
            if (!IsGloballySuppressed(def))
                return false;
        }

        return actionIds.Count > 0;
    }

    private KeybindTunnelResult? TryProcessGlobalSequence(
        List<KeybindActionDefinition> globalArmed,
        KeybindPhysicalInput input,
        DateTime utcNow,
        SequenceSwallowMode swallowMode)
    {
        var sequences = globalArmed
            .SelectMany(d => d.Bindings.Where(b => b.Kind == KeybindBindingKind.Sequence && b.SequenceSteps is { Count: > 0 })
                .Select(b => (Def: d, Steps: b.SequenceSteps!.ToArray())))
            .ToList();

        if (_globalSeqCandidates == null || _globalSeqCandidates.Count == 0)
        {
            var starters = new List<SequenceCandidate>();
            foreach (var (seqDef, steps) in sequences)
            {
                if (!CanonicalKeyGestureCodec.ChordsMatch(steps[0], input)) continue;
                if (steps.Length == 1)
                {
                    if (IsGloballySuppressed(seqDef))
                        continue;
                    _globalSeqCandidates = null;
                    return new KeybindTunnelResult(true, true, seqDef.ActionId, false);
                }

                starters.Add(new SequenceCandidate { ActionId = seqDef.ActionId, Steps = steps, Depth = 1 });
            }

            if (starters.Count == 0)
                return null;

            var ids = starters.Select(s => s.ActionId).Distinct(StringComparer.Ordinal).ToList();
            if (AllCandidatesSuppressed(ids))
                return null;

            _globalSeqCandidates = starters;
            _globalSeqStartedUtc = utcNow;
            var swallow = swallowMode == SequenceSwallowMode.SwallowOnPrefixAdvance;
            return new KeybindTunnelResult(swallow, false, null, swallow);
        }

        var next = new List<SequenceCandidate>();
        foreach (var c in _globalSeqCandidates)
        {
            if (c.Depth >= c.Steps.Length) continue;
            if (!CanonicalKeyGestureCodec.ChordsMatch(c.Steps[c.Depth], input)) continue;
            next.Add(new SequenceCandidate { ActionId = c.ActionId, Steps = c.Steps, Depth = c.Depth + 1 });
        }

        if (next.Count == 0)
        {
            _globalSeqCandidates = null;
            return null;
        }

        var completed = next.Where(c => c.Depth >= c.Steps.Length).ToList();
        if (completed.Count > 0)
        {
            var pick = completed[0];
            var pickDef = globalArmed.FirstOrDefault(d => d.ActionId == pick.ActionId);
            if (pickDef == null || IsGloballySuppressed(pickDef))
            {
                _globalSeqCandidates = null;
                return KeybindTunnelResult.NoMatch();
            }

            _globalSeqCandidates = null;
            return new KeybindTunnelResult(true, true, pick.ActionId, false);
        }

        var partialIds = next.Select(s => s.ActionId).Distinct(StringComparer.Ordinal).ToList();
        if (AllCandidatesSuppressed(partialIds))
        {
            _globalSeqCandidates = null;
            return null;
        }

        _globalSeqCandidates = next;
        _globalSeqStartedUtc = utcNow;

        var swallowPrefix = swallowMode == SequenceSwallowMode.SwallowOnPrefixAdvance;
        return new KeybindTunnelResult(swallowPrefix, false, null, swallowPrefix);
    }

    private KeybindBubbleResult? TryProcessLocalSequence(
        List<KeybindActionDefinition> localArmed,
        KeybindPhysicalInput input,
        DateTime utcNow,
        SequenceSwallowMode swallowMode)
    {
        var sequences = localArmed
            .SelectMany(d => d.Bindings.Where(b => b.Kind == KeybindBindingKind.Sequence && b.SequenceSteps is { Count: > 0 })
                .Select(b => (d.ActionId, Steps: b.SequenceSteps!.ToArray())))
            .ToList();

        if (_localSeqCandidates == null || _localSeqCandidates.Count == 0)
        {
            var starters = new List<SequenceCandidate>();
            foreach (var (actionId, steps) in sequences)
            {
                if (!CanonicalKeyGestureCodec.ChordsMatch(steps[0], input)) continue;
                if (steps.Length == 1)
                {
                    _localSeqCandidates = null;
                    return new KeybindBubbleResult(true, true, actionId, false);
                }

                starters.Add(new SequenceCandidate { ActionId = actionId, Steps = steps, Depth = 1 });
            }

            if (starters.Count == 0)
                return null;

            _localSeqCandidates = starters;
            _localSeqStartedUtc = utcNow;
            var swallow = swallowMode == SequenceSwallowMode.SwallowOnPrefixAdvance;
            return new KeybindBubbleResult(swallow, false, null, swallow);
        }

        var next = new List<SequenceCandidate>();
        foreach (var c in _localSeqCandidates)
        {
            if (c.Depth >= c.Steps.Length) continue;
            if (!CanonicalKeyGestureCodec.ChordsMatch(c.Steps[c.Depth], input)) continue;
            next.Add(new SequenceCandidate { ActionId = c.ActionId, Steps = c.Steps, Depth = c.Depth + 1 });
        }

        if (next.Count == 0)
        {
            _localSeqCandidates = null;
            return null;
        }

        var completedLocal = next.Where(c => c.Depth >= c.Steps.Length).ToList();
        if (completedLocal.Count > 0)
        {
            var pick = completedLocal[0];
            _localSeqCandidates = null;
            return new KeybindBubbleResult(true, true, pick.ActionId, false);
        }

        _localSeqCandidates = next;
        _localSeqStartedUtc = utcNow;

        var swallowP = swallowMode == SequenceSwallowMode.SwallowOnPrefixAdvance;
        return new KeybindBubbleResult(swallowP, false, null, swallowP);
    }

    private void TryExpireGlobalSequence(DateTime utcNow)
    {
        if (_globalSeqCandidates == null || _globalSeqCandidates.Count == 0) return;
        if ((utcNow - _globalSeqStartedUtc).TotalSeconds > DefaultSequenceTimeoutSeconds)
            _globalSeqCandidates = null;
    }

    private void TryExpireLocalSequence(DateTime utcNow)
    {
        if (_localSeqCandidates == null || _localSeqCandidates.Count == 0) return;
        if ((utcNow - _localSeqStartedUtc).TotalSeconds > DefaultSequenceTimeoutSeconds)
            _localSeqCandidates = null;
    }

    private static bool IsEscape(KeybindPhysicalInput input) =>
        string.Equals(input.KeyToken, "Escape", StringComparison.OrdinalIgnoreCase) &&
        input.Modifiers == KeybindModifierMask.None;
}
