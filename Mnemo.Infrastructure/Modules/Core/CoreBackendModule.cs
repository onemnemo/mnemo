using System;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.Infrastructure.Modules.Core;

/// <summary>
/// The application-wide registrations that belong to no single feature: the global chords and
/// the editor chord catalog, plus the tools the assistant uses to act on the app itself. The
/// shell's own view models are registered by the Avalonia half of this module.
/// </summary>
public sealed class CoreBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        var app = services.GetRequiredService<ApplicationToolService>();
        ApplicationToolRegistrar.Register(registry, app);
        SkillDiscoveryToolRegistrar.Register(registry, services.GetRequiredService<SkillDiscoveryToolService>());
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterKeybindManifest(IKeybindManifestRegistry registry)
    {
        registry.Register(new KeybindActionDefinition
        {
            ActionId = "global.search",
            Namespace = "global",
            Scope = KeybindScope.Global,
            Module = "core",
            DisplayLabelKey = "global.search",
            DisplayDescriptionKey = "global.search.description",
            DisplayCategoryKey = "category.general",
            AllowedDuringTextCapture = true,
            ToggleOnRepeat = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+K")
                }
            ]
        });

        registry.Register(new KeybindActionDefinition
        {
            ActionId = "global.assistant",
            Namespace = "global",
            Scope = KeybindScope.Global,
            Module = "core",
            DisplayLabelKey = "global.assistant",
            DisplayDescriptionKey = "global.assistant.description",
            DisplayCategoryKey = "category.general",
            AllowedDuringTextCapture = true,
            ToggleOnRepeat = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+J")
                }
            ]
        });

        registry.Register(new KeybindActionDefinition
        {
            ActionId = "global.quick-actions",
            Namespace = "global",
            Scope = KeybindScope.Global,
            Module = "core",
            DisplayLabelKey = "global.quick-actions",
            DisplayDescriptionKey = "global.quick-actions.description",
            DisplayCategoryKey = "category.general",
            ToggleOnRepeat = true,
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Alt+Shift+Q")
                }
            ]
        });

        foreach (var chord in EditorKeybindManifest.Chords)
        {
            registry.Register(new KeybindActionDefinition
            {
                ActionId = chord.ActionId,
                Namespace = EditorKeybindManifest.Namespace,
                Scope = KeybindScope.Local,
                Module = "editor",
                DisplayLabelKey = chord.ActionId,
                DisplayDescriptionKey = chord.DescriptionKey,
                DisplayCategoryKey = chord.DisplayCategoryKey,
                Bindings =
                [
                    new KeybindBindingEntry
                    {
                        Kind = KeybindBindingKind.Chord,
                        Chord = CanonicalKeyGestureCodec.ParseChord(chord.Gesture)
                    }
                ]
            });
        }
    }
}

/// <summary>Local rich-text editor chords (namespace <c>editor</c> for notes/flashcards routes).</summary>
internal static class EditorKeybindManifest
{
    public const string Namespace = "editor";

    public readonly record struct ChordEntry(
        string ActionId,
        string Gesture,
        string? DescriptionKey,
        string DisplayCategoryKey = "category.formatting");

    public static readonly ChordEntry[] Chords =
    [
        new("editor.bold", "Primary+B", null),
        new("editor.italic", "Primary+I", null),
        new("editor.underline", "Primary+U", null),
        new("editor.strikethrough", "Primary+Shift+S", null),
        new("editor.highlight", "Primary+Shift+H", null),
        new("editor.link", "Primary+Shift+L", null),
        new("editor.subscript", "Primary+OemComma", null),
        new("editor.superscript", "Primary+OemPeriod", null),
        new("editor.clipboard.copy", "Primary+C", "editor.clipboard.copy.description", "category.clipboard"),
        new("editor.clipboard.cut", "Primary+X", "editor.clipboard.cut.description", "category.clipboard"),
        new("editor.clipboard.paste", "Primary+V", "editor.clipboard.paste.description", "category.clipboard"),
    ];
}
