using System;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Notes.Services;

namespace Mnemo.UI.Modules.Notes;

/// <summary>
/// The notes screens. Translations, navigation, search, tools and the editor chords are
/// registered by <c>NotesBackendModule</c>, which runs in both shells.
/// </summary>
public class NotesModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        // Must be a singleton: NotesViewModel, NotesEditorSession, NotesTreeMutator and
        // NotesDocumentMutator all need to share the same in-memory note library. With a
        // transient registration each got its own empty instance, so e.g. child pages created
        // by the mutator were invisible to the editor session's title resolver ("Missing note").
        services.AddSingleton<NotesLibrarySession>();
        services.AddTransient<NotesEditorSession>();
        services.AddTransient<NotesEditorHistory>();
        services.AddTransient<NotesTreeMutator>();
        services.AddTransient<NotesDocumentMutator>();
        services.AddTransient<ViewModels.NotesViewModel>();
        services.AddSingleton<INotesEditorViewDispatch, NotesEditorViewDispatch>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("notes", typeof(ViewModels.NotesViewModel));
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }
}
