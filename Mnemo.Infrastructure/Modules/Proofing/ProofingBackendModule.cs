using System;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>
/// Registers spell checking: the bundled dictionary catalog, the Hunspell engine, the registry that
/// picks engines per language, the two stores holding what the user has told the checker to accept,
/// and the per-note record of which languages to check in.
/// <para>
/// The engine is registered against <see cref="IProofingEngine"/> rather than by its own type, so a
/// second engine for a language is one more registration and nothing else changes.
/// </para>
/// <para>
/// No translations: every string this feature shows belongs to the editor and settings surfaces, and
/// those live in the shared bundle.
/// </para>
/// </summary>
public sealed class ProofingBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddSingleton<ProofingDictionaryCatalog>();
        services.AddSingleton<IProofingEngine, HunspellProofingEngine>();
        services.AddSingleton<IProofingEngineRegistry, ProofingEngineRegistry>();
        services.AddSingleton<IPersonalDictionaryService, PersonalDictionaryService>();
        services.AddSingleton<INoteIgnoreService, NoteIgnoreService>();
        services.AddSingleton<INoteLanguageService, NoteLanguageService>();
        services.AddSingleton<IProofingService, ProofingService>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
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
