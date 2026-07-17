using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.History;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;
using Mnemo.Core.Services.Search;
using Mnemo.Host.Events;
using Mnemo.Host.HeadlessShell;
using Mnemo.Host.I18n;
using Mnemo.Infrastructure.History;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.AI;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.ImportExport;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.Keybinds;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Mnemo.Infrastructure.Services.Notes;
using Mnemo.Infrastructure.Services.Notes.Pdf;
using Mnemo.Infrastructure.Services.Packaging;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.Infrastructure.Services.Spellcheck;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.Infrastructure.Services.TextShortcuts;
using Mnemo.Infrastructure.Services.Tools;
using Mnemo.Infrastructure.Services.Updates;
using Mnemo.Infrastructure.Services.Widgets;
using Mnemo.UI.Services;

namespace Mnemo.Host.Composition;

/// <summary>
/// The host's composition root. Mirrors the backend half of the Avalonia app's
/// <c>Bootstrapper.Build()</c> (Mnemo.UI/Services/Bootstrapper.cs) and must be kept
/// in lockstep with it until cutover consolidates the two; UI-only registrations are
/// replaced by the HeadlessShell bindings or deliberately left unbound (each delta
/// is commented inline at the spot where Bootstrapper registers the UI variant).
/// </summary>
public static class HostComposition
{
    /// <summary>
    /// Finds every <see cref="IModule"/> the same way the Avalonia app does, but
    /// collects discovery failures for logging instead of silently swallowing them.
    /// </summary>
    public static IReadOnlyList<IModule> DiscoverModules(out IReadOnlyList<string> failures)
    {
        var modules = new List<IModule>();
        var errors = new List<string>();

        var assemblies = new HashSet<Assembly>();
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            if (assembly.FullName?.StartsWith("Mnemo.", StringComparison.Ordinal) == true)
                assemblies.Add(assembly);
        }

        // All modules live in Mnemo.UI during the parallel phases; make sure that
        // assembly is loaded even though the host never initializes Avalonia.
        assemblies.Add(typeof(Bootstrapper).Assembly);

        foreach (var assembly in assemblies)
        {
            Type[] exportedTypes;
            try
            {
                exportedTypes = assembly.GetExportedTypes();
            }
            catch (Exception ex)
            {
                errors.Add($"Could not enumerate types in {assembly.FullName}: {ex.Message}");
                continue;
            }

            foreach (var type in exportedTypes)
            {
                if (type.IsInterface || type.IsAbstract || !typeof(IModule).IsAssignableFrom(type))
                    continue;

                try
                {
                    modules.Add((IModule)Activator.CreateInstance(type)!);
                }
                catch (Exception ex)
                {
                    errors.Add($"Could not construct module {type.FullName}: {ex.Message}");
                }
            }
        }

        failures = errors;
        return modules;
    }

    /// <summary>
    /// Registers the Core/Infrastructure service graph plus the headless shell
    /// bindings, and runs the backend-side module registrations (translation
    /// sources, ConfigureServices, keybind manifests). The UI-side module hooks
    /// (routes, sidebar, widgets, tools) are not replayed here.
    /// </summary>
    public static void AddMnemoBackend(IServiceCollection services, IReadOnlyList<IModule> modules)
    {
        // 1. Core/Infrastructure services (Bootstrapper section 1)
        services.AddSingleton<IHistoryManager, HistoryManager>();
        services.AddSingleton<ILoggerService, LoggerService>();
        services.AddSingleton<IStorageProvider, SqliteStorageProvider>();
        services.AddSingleton<IChatModuleHistoryService, ChatModuleHistoryService>();
        services.AddSingleton<IChatHistoryClearService, ChatHistoryClearService>();
        services.AddSingleton<ISettingsService, SettingsService>();
        services.AddSingleton<IPerfDiagnostics, PerfDiagnosticsService>();
        services.AddSingleton<IUpdateService, VelopackUpdateService>();
        // ILaTeXEngine / INotePdfLatexImageRenderer: unbound. Both render through
        // Avalonia; PDF export tolerates the missing renderer and math moves to
        // KaTeX in the SPA.
        services.AddSingleton<IMarkdownProcessor, MarkdownProcessor>();
        // IMarkdownRenderer / ITextMateSyntaxHighlighter / INoteClipboardPlatformService:
        // unbound. Implementations are Avalonia-side and nothing outside Mnemo.UI
        // consumes them.
        services.AddSingleton<INoteClipboardPayloadCodec, NoteClipboardPayloadCodec>();
        services.AddSingleton<IImageAssetService, ImageAssetService>();
        services.AddSingleton<ITextShortcutService, TextShortcutService>();
        services.AddSingleton<ISpellDictionaryCatalogService, SpellDictionaryCatalogService>();
        services.AddSingleton<IUserSpellbookService, UserSpellbookService>();
        services.AddSingleton<ISpellcheckService, HunspellSpellcheckService>();

        // Tool surface (skills + dispatcher; consumed in-process by the AI gateway)
        services.AddSingleton<ISkillRegistry, SkillRegistry>();
        services.AddSingleton<ISkillSystemPromptComposer, SkillSystemPromptComposer>();
        services.AddSingleton<IToolResultFormatter, ToolResultFormatter>();
        // Headless substitution: the Avalonia app binds AvaloniaMainThreadDispatcher.
        services.AddSingleton<IMainThreadDispatcher, HeadlessMainThreadDispatcher>();
        services.AddSingleton(sp => new NotesToolService(
            sp.GetRequiredService<INoteService>(),
            sp.GetRequiredService<INavigationService>(),
            sp.GetRequiredService<IMainThreadDispatcher>(),
            sp.GetService<INoteFolderService>()));
        services.AddSingleton<ApplicationToolService>();
        services.AddSingleton<IToolDispatchAmbient, ToolDispatchAmbient>();
        services.AddSingleton<ISkillInjectionOverrideStore, SkillInjectionOverrideStore>();
        services.AddSingleton<SkillDiscoveryToolService>();
        services.AddSingleton<SettingsToolService>();
        services.AddSingleton<IMindmapIntegrityService, MindmapIntegrityService>();
        services.AddSingleton(sp => new MindmapToolService(
            sp.GetRequiredService<IMindmapService>(),
            sp.GetRequiredService<IMindmapIntegrityService>()));
        services.AddSingleton<IToolDispatcher, ToolDispatcher>();

        // Conversation memory
        services.AddSingleton<IConversationMemoryStore>(sp =>
            new ConversationMemoryStore(sp.GetRequiredService<ILoggerService>()));
        services.AddSingleton<IConversationSummarizer>(sp =>
            new ConversationSummarizer(sp.GetRequiredService<IAIOrchestrator>()));
        services.AddSingleton<IConversationMemoryInjector, ConversationMemoryInjector>();

        // MnemoMcpOptions / MnemoMcpServer: unbound. The MCP server keeps running
        // inside the Avalonia app until its scheduled relocation into this host.

        // Mnemo AI stack: orchestrator + tool gateway over the v2 contracts.
        // Chat responses can stream for minutes, so the shared HttpClient must not impose
        // its default 100s overall timeout; the chat client bounds time-to-first-headers.
        services.AddHttpClient(OpenRouterChatClient.HttpClientName,
            client => client.Timeout = System.Threading.Timeout.InfiniteTimeSpan);
        services.AddSingleton<IChatModelClient, OpenRouterChatClient>();
        services.AddSingleton<IModelRouter, ModelRouter>();
        services.AddSingleton<IModelCatalogService, OpenRouterModelCatalog>();
        services.AddSingleton<IAiKeyValidator, OpenRouterKeyValidator>();
        services.AddSingleton<IAiToolGateway, AiToolGateway>();
        services.AddSingleton<IAIOrchestrator, AIOrchestrator>();

        services.AddSingleton<IAITaskManager, AITaskManager>();
        services.AddSingleton<IAiSystemMonitor, StubAiSystemMonitor>();

        // Tracks in-flight chat turns so the SSE stream endpoint and the stop button share cancellation.
        services.AddSingleton<Chat.ChatTurnRegistry>();

        services.AddSingleton<INoteService, NoteService>();
        services.AddSingleton<INoteFolderService, NoteFolderService>();
        services.AddSingleton<INotePdfExportService, NotePdfExportService>();

        // Relational flashcard store: owned store, repositories, and blob-to-relational migrator.
        services.AddSingleton<IFlashcardStore, FlashcardStore>();
        services.AddSingleton<IFolderRepository, FolderRepository>();
        services.AddSingleton<IPresetRepository, PresetRepository>();
        services.AddSingleton<IDeckRepository, DeckRepository>();
        services.AddSingleton<ICardRepository, CardRepository>();
        services.AddSingleton<IScheduleRepository, ScheduleRepository>();
        services.AddSingleton<IReviewRepository, ReviewRepository>();
        services.AddSingleton<ITestAttemptRepository, TestAttemptRepository>();
        services.AddSingleton<IDailyStatsRepository, DailyStatsRepository>();
        services.AddSingleton<IFlashcardStoreMigrator, FlashcardStoreMigrator>();

        services.AddSingleton<IFsrsScheduler, FsrsScheduler>();

        services.AddSingleton<IFlashcardLibraryService, FlashcardLibraryService>();
        services.AddSingleton<IFlashcardCardService, FlashcardCardService>();
        services.AddSingleton<IFlashcardStudyService, FlashcardStudyService>();
        services.AddSingleton<IFlashcardPresetService, FlashcardPresetService>();
        services.AddSingleton<IFlashcardStatsService, FlashcardStatsService>();
        services.AddSingleton<IMnemoPackageService, MnemoPackageService>();
        services.AddSingleton<IMnemoPayloadHandler, NotesMnemoPayloadHandler>();
        services.AddSingleton<IMnemoPayloadHandler, SettingsMnemoPayloadHandler>();
        services.AddSingleton<IMnemoPayloadHandler, FlashcardsMnemoPayloadHandler>();
        services.AddSingleton<IMnemoPayloadHandler, MindmapsMnemoPayloadHandler>();
        services.AddSingleton<IImportExportCoordinator, ImportExportCoordinator>();
        services.AddSingleton<IContentFormatAdapter, NotesMnemoFormatAdapter>();
        services.AddSingleton<IContentFormatAdapter, NotesMarkdownFormatAdapter>();
        services.AddSingleton<IContentFormatAdapter, FlashcardsMnemoFormatAdapter>();
        services.AddSingleton<IContentFormatAdapter, FlashcardsCsvFormatAdapter>();
        services.AddSingleton<IContentFormatAdapter, FlashcardsAnkiFormatAdapter>();
        services.AddSingleton<IContentFormatAdapter, MindmapsMnemoFormatAdapter>();

        // 2. Shell services: headless substitutions for the Avalonia-bound set.
        // App-events channel: the fan-out the headless shell pushes toasts (and
        // later theme/navigation changes) through to reach the SPA over SSE.
        services.AddSingleton<AppEventHub>();
        services.AddSingleton<IAppEventPublisher>(sp => sp.GetRequiredService<AppEventHub>());
        services.AddSingleton<IAppEventSource>(sp => sp.GetRequiredService<AppEventHub>());

        services.AddSingleton<IThemeService, HeadlessThemeService>();
        services.AddSingleton<IOverlayService, HeadlessOverlayService>();
        services.AddSingleton<IToastService, HeadlessToastService>();
        services.AddSingleton<IUIService, HeadlessUIService>();

        services.AddSingleton<HeadlessNavigationService>();
        services.AddSingleton<INavigationService>(sp => sp.GetRequiredService<HeadlessNavigationService>());
        services.AddSingleton<INavigationRegistry>(sp => sp.GetRequiredService<HeadlessNavigationService>());

        services.AddSingleton<HeadlessSidebarService>();
        services.AddSingleton<ISidebarService>(sp => sp.GetRequiredService<HeadlessSidebarService>());

        services.AddSingleton<IFunctionRegistry, FunctionRegistry>();
        services.AddSingleton<IWidgetRegistry, WidgetRegistry>();
        services.AddSingleton<IWidgetLayoutEngine, WidgetLayoutEngine>();
        services.AddSingleton<IOverviewLayoutStore, OverviewLayoutStore>();
        services.AddSingleton<IWidgetContext, WidgetContext>();

        services.AddSingleton<IStatisticsManager, StatisticsManager>();
        services.AddSingleton<StatisticsToolService>();
        services.AddSingleton<NavigationStatisticsTracker>();
        services.AddSingleton<IGlobalSearchService, GlobalSearchService>();
        services.AddSingleton<ISearchProvider, NavigationSearchProvider>();

        // 3. Modules: backend-side registrations only, same ordering as the Avalonia app.
        services.AddSingleton<IReadOnlyList<IModule>>(modules);
        services.AddSingleton<IAiAssistantToolHost, AiAssistantToolHost>();
        var translationRegistry = new TranslationSourceRegistry();
        translationRegistry.Add(new EmbeddedBuiltInTranslationSource());
        foreach (var module in modules)
        {
            module.RegisterTranslationSources(translationRegistry);
        }

        services.AddSingleton<ILocalizationService>(sp => new LocalizationService(
            translationRegistry.Sources,
            sp.GetRequiredService<ILoggerService>(),
            "en"));
        // Expose the ordered sources so the i18n endpoints can serve the SPA the
        // same merged bundle the desktop app builds.
        services.AddSingleton<IReadOnlyList<ITranslationSource>>(translationRegistry.Sources);
        services.AddSingleton<TranslationBundleService>();
        services.AddSingleton<IDateDisplayService, DateDisplayService>();

        var registrar = new ServiceRegistrar(services);
        foreach (var module in modules)
        {
            module.ConfigureServices(registrar);
        }

        var keybindManifestCollector = new KeybindManifestCollector();
        foreach (var module in modules)
        {
            module.RegisterKeybindManifest(keybindManifestCollector);
        }

        services.AddSingleton<IKeybindRepository, SqliteKeybindRepository>();
        services.AddSingleton<IKeyMap>(sp => new KeyMapService(
            sp.GetRequiredService<IKeybindRepository>(),
            sp.GetRequiredService<ILoggerService>(),
            keybindManifestCollector.GetAll()));
        // IKeybindActionRouter / IEditorKeybindDispatch / IBlockEditorClipboardKeybindDispatch /
        // IMindmapKeybindDispatch: unbound. Keystroke matching and dispatch live in the
        // browser; the server only owns definitions and overrides (IKeyMap).
    }

    /// <summary>
    /// Post-build startup work, mirroring the Avalonia app's ordering guarantee:
    /// the flashcard migration completes (or fails logged) before any endpoint can
    /// serve a read, and both SQLite stores are warmed so the first request never
    /// races schema creation.
    /// </summary>
    public static async Task InitializeBackendAsync(IServiceProvider services, IReadOnlyList<string> moduleDiscoveryFailures)
    {
        var logger = services.GetRequiredService<ILoggerService>();

        foreach (var failure in moduleDiscoveryFailures)
        {
            logger.Error("Mnemo.Host", $"Module discovery: {failure}");
        }

        // Replay the module sidebar registrations against the headless sidebar
        // service so the nav endpoint serves the same items the desktop builds.
        // These registrations are pure metadata (labels, routes, icons), so unlike
        // the other UI-side module hooks they are safe to run in the host.
        var sidebar = services.GetRequiredService<ISidebarService>();
        foreach (var module in services.GetRequiredService<IReadOnlyList<IModule>>())
        {
            module.RegisterSidebarItems(sidebar);
        }

        try
        {
            await services.GetRequiredService<IFlashcardStoreMigrator>()
                .MigrateAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Same policy as the Avalonia app: a failed migration must not brick
            // startup; the store still self-initializes a valid (empty) schema.
            logger.Error("Mnemo.Host", "Flashcard store migration failed during startup.", ex);
        }

        await services.GetRequiredService<IFlashcardStore>()
            .InitializeAsync().ConfigureAwait(false);
        _ = await services.GetRequiredService<IStorageProvider>()
            .LoadAsync<object>("__host_warmup__").ConfigureAwait(false);
    }
}
