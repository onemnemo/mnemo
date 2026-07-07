using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services.Keybinds;
using Mnemo.Infrastructure.Services.Keybinds;

namespace Mnemo.Infrastructure.Tests.Keybinds;

public sealed class KeyMapServiceTests
{
    private static KeybindActionDefinition GlobalChord(string id, string gesture) =>
        new()
        {
            ActionId = id,
            Namespace = "core",
            Scope = KeybindScope.Global,
            Enabled = true,
            Bindings = new[]
            {
                new KeybindBindingEntry { Kind = KeybindBindingKind.Chord, Chord = CanonicalKeyGestureCodec.ParseChord(gesture) },
            },
        };

    private static KeybindActionDefinition GlobalSeq(string id, params string[] steps) =>
        new()
        {
            ActionId = id,
            Namespace = "core",
            Scope = KeybindScope.Global,
            Enabled = true,
            Bindings = new[]
            {
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Sequence,
                    SequenceSteps = steps.Select(CanonicalKeyGestureCodec.ParseChord).ToList(),
                },
            },
        };

    [Fact]
    public void GlobalChord_Matches()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var sut = new KeyMapService(repo, logger, new[] { GlobalChord("global.search", "Primary+K") });
        var input = new KeybindPhysicalInput(KeybindModifierMask.Primary, "K");
        var r = sut.ProcessGlobalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.True(r.Handled);
        Assert.True(r.CompletedAction);
        Assert.Equal("global.search", r.ActionId);
    }

    [Fact]
    public void TextCapture_SuppressesGlobalChord_WhenNotAllowedDuringCapture()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var sut = new KeyMapService(repo, logger, new[] { GlobalChord("global.other", "Primary+K") });
        sut.EnterTextCapture();
        var input = new KeybindPhysicalInput(KeybindModifierMask.Primary, "K");
        var r = sut.ProcessGlobalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.False(r.Handled);
    }

    [Fact]
    public void TextCapture_GlobalChord_Matches_WhenAllowedDuringTextCapture()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var def = new KeybindActionDefinition
        {
            ActionId = "global.search",
            Namespace = "global",
            Scope = KeybindScope.Global,
            AllowedDuringTextCapture = true,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+K"),
                },
            ],
        };
        var sut = new KeyMapService(repo, logger, new[] { def });
        sut.EnterTextCapture();
        var input = new KeybindPhysicalInput(KeybindModifierMask.Primary, "K");
        var r = sut.ProcessGlobalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.True(r.Handled);
        Assert.True(r.CompletedAction);
        Assert.Equal("global.search", r.ActionId);
    }

    [Fact]
    public void SharedSequenceLeader_SwallowsPrefix_WhenNotSuppressed()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var sut = new KeyMapService(repo, logger, new[]
        {
            GlobalSeq("a", "G", "K"),
            GlobalSeq("b", "G", "T"),
        });
        var g = new KeybindPhysicalInput(KeybindModifierMask.None, "G");
        var r = sut.ProcessGlobalKeyDown(g, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.True(r.Handled);
        Assert.False(r.CompletedAction);
        Assert.True(r.SwallowedPrefixOnly);
    }

    [Fact]
    public void SharedSequenceLeader_NoSwallow_WhenAllCandidatesSuppressedByPolicy()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var sut = new KeyMapService(repo, logger, new[]
        {
            GlobalSeq("a", "G", "K"),
            GlobalSeq("b", "G", "T"),
        });
        sut.PushSuppression(
            "test",
            new KeybindSuppressionPolicy { OnlyActionIds = new[] { "a", "b" } });
        var g = new KeybindPhysicalInput(KeybindModifierMask.None, "G");
        var r = sut.ProcessGlobalKeyDown(g, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.False(r.Handled);
    }

    [Fact]
    public void LocalChord_Matches_WhenActiveNamespaceMindmap()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var def = new KeybindActionDefinition
        {
            ActionId = "mindmap.add-child",
            Namespace = "mindmap",
            Scope = KeybindScope.Local,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Tab"),
                },
            ],
        };
        var sut = new KeyMapService(repo, logger, new[] { def });
        sut.SetActiveRoute("mindmap-detail", "mindmap");
        var input = new KeybindPhysicalInput(KeybindModifierMask.None, "Tab");
        var r = sut.ProcessLocalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.True(r.CompletedAction);
        Assert.Equal("mindmap.add-child", r.ActionId);
    }

    [Fact]
    public void LocalMindmap_NoMatch_WhenOverviewRoute_HasNullNamespace()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var def = new KeybindActionDefinition
        {
            ActionId = "mindmap.add-child",
            Namespace = "mindmap",
            Scope = KeybindScope.Local,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Tab"),
                },
            ],
        };
        var sut = new KeyMapService(repo, logger, new[] { def });
        sut.SetActiveRoute("mindmap", null);
        var input = new KeybindPhysicalInput(KeybindModifierMask.None, "Tab");
        var r = sut.ProcessLocalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.False(r.Handled);
    }

    [Fact]
    public void LocalChord_Matches_WhenActiveNamespaceEditor()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var def = new KeybindActionDefinition
        {
            ActionId = "editor.bold",
            Namespace = "editor",
            Scope = KeybindScope.Local,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+B"),
                },
            ],
        };
        var sut = new KeyMapService(repo, logger, new[] { def });
        sut.SetActiveRoute("notes", "editor");
        var input = new KeybindPhysicalInput(KeybindModifierMask.Primary, "B");
        var r = sut.ProcessLocalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.True(r.CompletedAction);
        Assert.Equal("editor.bold", r.ActionId);
    }

    [Fact]
    public void TextCapture_SuppressesSharedLeader()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var sut = new KeyMapService(repo, logger, new[]
        {
            GlobalSeq("a", "G", "K"),
            GlobalSeq("b", "G", "T"),
        });
        sut.EnterTextCapture();
        var g = new KeybindPhysicalInput(KeybindModifierMask.None, "G");
        var r = sut.ProcessGlobalKeyDown(g, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.False(r.Handled);
    }

    [Fact]
    public void LocalChord_EditorNamespaceAction_Matches_OnEditorScopedRoute()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var def = new KeybindActionDefinition
        {
            ActionId = "editor.local-chord",
            Namespace = "editor",
            Scope = KeybindScope.Local,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+Enter"),
                },
            ],
        };
        var sut = new KeyMapService(repo, logger, new[] { def });
        sut.SetActiveRoute("flashcard-deck", "editor");
        var input = new KeybindPhysicalInput(KeybindModifierMask.Primary, "Enter");
        var r = sut.ProcessLocalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.True(r.CompletedAction);
        Assert.Equal("editor.local-chord", r.ActionId);
    }

    [Fact]
    public void LocalChord_EditorNamespaceAction_DoesNotMatch_OnUnscopedRoute()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var def = new KeybindActionDefinition
        {
            ActionId = "editor.local-chord",
            Namespace = "editor",
            Scope = KeybindScope.Local,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+Enter"),
                },
            ],
        };
        var sut = new KeyMapService(repo, logger, new[] { def });
        sut.SetActiveRoute("flashcards", null);
        var input = new KeybindPhysicalInput(KeybindModifierMask.Primary, "Enter");
        var r = sut.ProcessLocalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        Assert.False(r.Handled);
    }

    [Fact]
    public void GetAllStaticDefinitionsMerged_IncludesAllLocalNamespaces_WhileArmedDoesNot()
    {
        var logger = new TestLogger();
        var repo = new FakeKeybindRepository();
        var global = GlobalChord("global.search", "Primary+K");
        var editor = new KeybindActionDefinition
        {
            ActionId = "editor.bold",
            Namespace = "editor",
            Scope = KeybindScope.Local,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+B"),
                },
            ],
        };
        var mindmap = new KeybindActionDefinition
        {
            ActionId = "mindmap.undo",
            Namespace = "mindmap",
            Scope = KeybindScope.Local,
            Enabled = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+Z"),
                },
            ],
        };
        var sut = new KeyMapService(repo, logger, new[] { global, editor, mindmap });
        sut.SetActiveRoute("overview", null);

        var catalog = sut.GetAllStaticDefinitionsMerged();
        Assert.Equal(3, catalog.Count);

        var armed = sut.GetStaticArmedDefinitions();
        Assert.Single(armed);
        Assert.Equal("global.search", armed[0].ActionId);
    }
}
