using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.History;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;
using Mnemo.Core.Services.Search;
using Mnemo.Host.Events;
using Mnemo.Host.HeadlessShell;
using Mnemo.Host.I18n;
using Mnemo.Host.Lifecycle;
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
using Mnemo.Infrastructure.Services.Notes.Persistence;
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
    /// (routes, sidebar, widgets, tools) are not replayed here; the two that are
    /// pure metadata run from <see cref="InitializeBackendAsync"/> once the
    /// provider exists.
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
        // ILaTeXEngine: unbound. It renders through Avalonia; the SPA's math is KaTeX,
        // and PDF export renders real math through Typst.
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

        // Notes: the transactional writer, the sid/version backfill that gates note access, then the
        // services that depend on both.
        services.AddSingleton<NoteCommitStore>();
        services.AddSingleton<INoteCommitStore>(sp => sp.GetRequiredService<NoteCommitStore>());
        services.AddSingleton<INoteSidMigrator, NoteSidMigrator>();
        services.AddSingleton<INoteService, NoteService>();
        services.AddSingleton<INoteFolderService, NoteFolderService>();
        // PDF export/preview via Typst: real vector math through mitex, replacing the QuestPDF path
        // whose equations degraded to a Unicode approximation on this host. The binary sits beside
        // the app and the mitex package is vendored, so a compile needs no network. Explicit factories
        // rather than by-type wiring so the optional constructor arguments take their intended values.
        services.AddSingleton(new TypstBinaryProvider());
        services.AddSingleton(sp => new TypstCompiler(sp.GetRequiredService<TypstBinaryProvider>()));
        services.AddSingleton<INotePdfImageLocator, Notes.NoteAssetImageLocator>();
        services.AddSingleton<INotePdfExportService>(sp => new TypstNotePdfExportService(
            sp.GetRequiredService<TypstCompiler>(),
            sp.GetRequiredService<INotePdfImageLocator>()));
        // Image uploads, the editing-session registry, and the orphan sweep over them. The
        // instance lock is what keeps that sweep from deleting what another running instance's
        // undo history can still restore.
        services.AddSingleton(_ => Lifecycle.HostInstanceLock.Acquire());
        services.AddSingleton<Notes.NoteAssets>();

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

        // Holds live study sessions, which the desktop kept in the study screen's ViewModel.
        services.AddSingleton<Flashcards.StudySessionRegistry>();
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

        // Mindmap services themselves come from MindmapModule.ConfigureServices, which this host runs
        // like every other module registration. Only the bridge onto the events channel is host-side,
        // because the channel is.
        services.AddSingleton<Mindmap.MindmapChangeBridge>();

        // 2. Shell services: headless substitutions for the Avalonia-bound set.
        // App-events channel: the fan-out the headless shell pushes toasts (and
        // later theme/navigation changes) through to reach the SPA over SSE.
        services.AddSingleton<AppEventHub>();
        services.AddSingleton<IAppEventPublisher>(sp => sp.GetRequiredService<AppEventHub>());
        services.AddSingleton<IAppEventSource>(sp => sp.GetRequiredService<AppEventHub>());

        // The window's closing handler and the SPA's reply endpoint meet here.
        services.AddSingleton<ShutdownGate>();

        // Likewise for the native folder chooser: registered whether or not a window ever
        // attaches, so the endpoint can answer "not here" instead of failing to resolve.
        services.AddSingleton<NativeFolderPicker>();

        // App.LaunchAtStartup is a stored value on its own; this is what makes the OS act on it.
        services.AddSingleton<Startup.LaunchAtStartupService>();

        // The update state machine. A singleton because the update a check resolves is what
        // a later download and apply act on, and that lives in the instance rather than the
        // database.
        services.AddSingleton<Updates.UpdateCoordinator>();

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
        var modules = services.GetRequiredService<IReadOnlyList<IModule>>();
        var sidebar = services.GetRequiredService<ISidebarService>();
        foreach (var module in modules)
        {
            module.RegisterSidebarItems(sidebar);
        }

        RegisterModuleWidgets(modules, services.GetRequiredService<IWidgetRegistry>(), services);

        // Load the saved UI language so server-emitted strings (e.g. the persisted chat trace)
        // resolve to the same text the desktop would write. Mirrors Bootstrapper.LoadSavedLanguageAsync.
        var settings = services.GetRequiredService<ISettingsService>();
        var localization = services.GetRequiredService<ILocalizationService>();
        var savedLanguage = await settings.GetAsync<string>("App.Language", "en").ConfigureAwait(false);
        await localization.SetLanguageAsync(string.IsNullOrWhiteSpace(savedLanguage) ? "en" : savedLanguage)
            .ConfigureAwait(false);

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

        // Resolved for its constructor: it subscribes to the mindmap service there, and a bridge nobody
        // asks for is a bridge that never subscribes.
        _ = services.GetRequiredService<Mindmap.MindmapChangeBridge>();

        try
        {
            await services.GetRequiredService<IFlashcardStore>()
                .InitializeAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Same policy as the migration above. The store logs and rethrows by design, and
            // one corrupt or locked flashcards table must not take Notes, Chat and Settings
            // down with it; every read retries the open, so the flashcard endpoints are the
            // only ones that fail.
            logger.Error("Mnemo.Host", "Flashcard store initialization failed during startup.", ex);
        }

        _ = await services.GetRequiredService<IStorageProvider>()
            .LoadAsync<object>("__host_warmup__").ConfigureAwait(false);

        try
        {
            await services.GetRequiredService<INoteSidMigrator>()
                .MigrateAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Unlike the flashcard migration, a failure here is not shrugged off: the note endpoints
            // read IsComplete and stay closed, so the app starts and every other module works while
            // notes report unavailable. Serving a half-migrated corpus would be the worse outcome.
            logger.Error("Mnemo.Host", "Note sid migration failed during startup; note endpoints stay closed.", ex);
        }

        // Resolved for its constructor, which subscribes to the settings change it acts on,
        // then reconciled because the setting can have moved while this app was not running.
        await services.GetRequiredService<Startup.LaunchAtStartupService>()
            .ReconcileAsync().ConfigureAwait(false);
    }

    /// <summary>
    /// Replays the module widget registrations against the host's registry, the same pass the
    /// Avalonia app runs from Bootstrapper.
    /// </summary>
    /// <remarks>
    /// Like the sidebar items, descriptors are safe here: they are stateless, and the manifests
    /// they carry (supported sizes, setting schemas, icon uri) are data the host reads without
    /// ever building a view.
    /// <para>
    /// Leaving the registry empty is not a smaller version of this, it is a data loss. The
    /// overview store migrates a legacy v1 board on first read and looks up each widget's manifest
    /// to seed its default settings and snap the rescaled size, then writes the migrated board
    /// back under the v2 key. A profile whose first v2 read happened in a host with no descriptors
    /// would keep settingless, unsnapped widgets for good, because the desktop app afterwards
    /// finds a v2 board and never migrates again.
    /// </para>
    /// <para>
    /// Separate from <see cref="InitializeBackendAsync"/> so a test can build the registry exactly
    /// the way startup does.
    /// </para>
    /// </remarks>
    public static void RegisterModuleWidgets(
        IReadOnlyList<IModule> modules,
        IWidgetRegistry registry,
        IServiceProvider services)
    {
        foreach (var module in modules)
        {
            module.RegisterWidgets(registry, services);
        }
    }
}
