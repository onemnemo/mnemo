using System;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Mnemo.Core.Services.Search;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Notes;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.Infrastructure.Modules.Notes;

/// <summary>
/// Everything the notes module contributes that is not a screen: its translations, its place
/// in the navigation, the search provider, the assistant's note tools and the editor chords.
/// The editor itself is registered by the Avalonia half of this module.
/// </summary>
public sealed class NotesBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddSingleton<ISearchProvider, NotesSearchProvider>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        var assembly = typeof(NotesBackendModule).Assembly;
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Notes.Translations"));
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem("Notes", "notes", "avares://Mnemo.UI/Icons/Sidebar/notes.svg", "Modules", 1, 10);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        var notesToolService = services.GetRequiredService<NotesToolService>();
        NotesToolRegistrar.Register(registry, notesToolService);
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterKeybindManifest(IKeybindManifestRegistry registry)
    {
        registry.Register(new KeybindActionDefinition
        {
            ActionId = "editor.reset-view",
            Namespace = "editor",
            Scope = KeybindScope.Local,
            Module = "editor",
            DisplayLabelKey = "editor.reset-view",
            DisplayDescriptionKey = "editor.reset-view.description",
            DisplayCategoryKey = "category.view",
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+D0")
                }
            ]
        });

        // The editor matches this chord directly as well, so a save stays reachable if the
        // catalog is slow or fails to arrive. Registering it here is what puts it on the
        // keyboard settings page and lets someone move it.
        registry.Register(new KeybindActionDefinition
        {
            ActionId = "editor.save",
            Namespace = "editor",
            Scope = KeybindScope.Local,
            Module = "editor",
            DisplayLabelKey = "editor.save",
            DisplayDescriptionKey = "editor.save.description",
            DisplayCategoryKey = "category.file",
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+S")
                }
            ]
        });
    }
}
