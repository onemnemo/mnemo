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
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.History;
using Mnemo.Infrastructure.Modules.Core;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.AI;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Services.ImportExport;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.Keybinds;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Mnemo.Infrastructure.Services.Mindmap.Trash;
using Mnemo.Infrastructure.Services.Notes;
using Mnemo.Infrastructure.Services.Notes.Pdf;
using Mnemo.Infrastructure.Services.Notes.Persistence;
using Mnemo.Infrastructure.Services.Notes.Trash;
using Mnemo.Infrastructure.Services.Packaging;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.Infrastructure.Services.Spellcheck;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.Infrastructure.Services.TextShortcuts;
using Mnemo.Infrastructure.Services.Tools;
using Mnemo.Infrastructure.Services.Trash;
using Mnemo.Infrastructure.Services.Updates;
using Mnemo.Infrastructure.Services.Widgets;

namespace Mnemo.Host.Composition;

/// <summary>
/// The host's composition root. Builds the Core and Infrastructure service graph, the
/// headless shell bindings, and the backend-side module registrations.
/// </summary>
public static class HostComposition
{
    /// <summary>
    /// Finds every <see cref="IModule"/>, collecting discovery failures for logging
    /// instead of silently swallowing them.
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

        // The backend half of every module lives in Mnemo.Infrastructure; anchor on it rather
        // than trusting that something else has already pulled the assembly in.
        assemblies.Add(typeof(CoreBackendModule).Assembly);

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
        // 1. Core/Infrastructure services
        services.AddSingleton<IHistoryManager, HistoryManager>();
        services.AddSingleton<ILoggerService, LoggerService>();
        services.AddSingleton<IStorageProvider, SqliteStorageProvider>();
        services.AddSingleton<IChatModuleHistoryService, ChatModuleHistoryService>();
        services.AddSingleton<IChatHistoryClearService, ChatHistoryClearService>();
        services.AddSingleton<ISettingsService, SettingsService>();
        services.AddSingleton<IPerfDiagnostics, PerfDiagnosticsService>();
        services.AddSingleton<IUpdateService, VelopackUpdateService>();
        services.AddSingleton<IMarkdownProcessor, MarkdownProcessor>();
        // IMarkdownRenderer / ITextMateSyntaxHighlighter / INoteClipboardPlatformService:
        // unbound. Nothing in the host consumes them; the browser owns rendering,
        // highlighting and clipboard handling.
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
        services.AddSingleton<IMainThreadDispatcher, HeadlessMainThreadDispatcher>();
        services.AddSingleton(sp => new NotesToolService(
            sp.GetRequiredService<INoteService>(),
            sp.GetRequiredService<INoteCommitStore>(),
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
        services.AddSingleton<INoteTrashStore>(sp => sp.GetRequiredService<NoteCommitStore>());
        services.AddSingleton<INoteFolderStore>(sp => sp.GetRequiredService<NoteCommitStore>());
        services.AddSingleton<INoteSummaryStore>(sp => sp.GetRequiredService<NoteCommitStore>());
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
        services.AddSingleton<Mindmap.MindmapAssets>();

        // Relational flashcard store: owned store, repositories, and blob-to-relational migrator.
        services.AddSingleton<IFlashcardStore, FlashcardStore>();
        services.AddSingleton<IFolderRepository, FolderRepository>();
        services.AddSingleton<IPresetRepository, PresetRepository>();
        services.AddSingleton<IDeckRepository, DeckRepository>();
        services.AddSingleton<ICardRepository, CardRepository>();
        services.AddSingleton<ICardTypeRepository, CardTypeRepository>();
        services.AddSingleton<IFactRepository, FactRepository>();
        services.AddSingleton<IScheduleRepository, ScheduleRepository>();
        services.AddSingleton<IReviewRepository, ReviewRepository>();
        services.AddSingleton<ITestAttemptRepository, TestAttemptRepository>();
        services.AddSingleton<IDailyStatsRepository, DailyStatsRepository>();
        services.AddSingleton<IFlashcardStoreMigrator, FlashcardStoreMigrator>();
        services.AddSingleton<IFlashcardFactlessCardRepair, FlashcardFactlessCardRepair>();

        // Scheduling reads the time through this rather than the static properties, so day
        // boundaries stay one decision the tests can drive.
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<FlashcardClock>();

        services.AddSingleton<IFsrsScheduler, FsrsScheduler>();

        services.AddSingleton<FlashcardCardMaterializer>();

        services.AddSingleton<IFlashcardLibraryService, FlashcardLibraryService>();
        services.AddSingleton<IFlashcardCardService, FlashcardCardService>();
        services.AddSingleton<IFlashcardFactService, FlashcardFactService>();
        services.AddSingleton<IFlashcardStudyService, FlashcardStudyService>();
        services.AddSingleton<IFlashcardReviewHistoryService, FlashcardReviewHistoryService>();
        services.AddSingleton<IFlashcardPresetService, FlashcardPresetService>();
        services.AddSingleton<IFlashcardOptimizerService, FlashcardOptimizerService>();
        services.AddSingleton<IFlashcardStatsService, FlashcardStatsService>();

        // The day boundary analytics records and reads against, resolved the way the study screen
        // resolves it.
        services.AddSingleton<IStudyDayService, StudyDayService>();

        // Holds live study sessions, which outlive any single request.
        services.AddSingleton<Flashcards.StudySessionRegistry>();
        // Record sessions that remain open after the client shutdown handshake.
        services.AddHostedService<Flashcards.StudySessionFlush>();
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

        // Application trash. TrashMaintenance is resolved rather than injected into the coordinator,
        // because the coordinator is also what asks it for a pass.
        services.AddSingleton(sp => new TrashDatabase(sp.GetRequiredService<ILoggerService>()));
        services.AddSingleton<ITrashStore, TrashStore>();
        services.AddSingleton<IAssetCleanupStore, AssetCleanupStore>();
        services.AddSingleton<TrashSourceRegistry>();
        services.AddSingleton<TrashMaintenance>();
        services.AddSingleton<ITrashMaintenance>(sp => sp.GetRequiredService<TrashMaintenance>());
        services.AddSingleton<AssetCleanupWorker>();
        services.AddSingleton<ITrashService>(sp => new TrashService(
            sp.GetRequiredService<ITrashStore>(),
            sp.GetRequiredService<TrashSourceRegistry>(),
            sp.GetRequiredService<ILoggerService>(),
            sp.GetRequiredService<ITrashMaintenance>(),
            sp.GetRequiredService<TimeProvider>()));

        // The kinds each module owns. A store that holds both live and held rows exposes its trash
        // half through a second interface onto the one instance the module registered, so capture and
        // an ordinary save share a writer and cannot interleave.
        services.AddSingleton<IMindmapTrashStore>(sp => (IMindmapTrashStore)sp.GetRequiredService<IMindmapStore>());
        services.AddSingleton<ITrashSource, MindmapTrashSource>();
        services.AddSingleton<ITrashSource, MindmapFolderTrashSource>();
        services.AddSingleton<IAssetCleanupOwner, Mindmap.MindmapAssetCleanupOwner>();
        services.AddSingleton<ITrashSource, NoteTrashSource>();
        services.AddSingleton<ITrashSource, NoteFolderTrashSource>();
        services.AddSingleton<ITrashSource, FlashcardDeckFolderTrashSource>();
        services.AddSingleton<ITrashSource, FlashcardDeckTrashSource>();
        services.AddSingleton<ITrashSource, FlashcardFactTrashSource>();
        services.AddSingleton<ITrashSource, FlashcardCardTrashSource>();
        services.AddSingleton<IAssetCleanupOwner, Flashcards.FlashcardAssetCleanupOwner>();

        // Mindmap services themselves come from MindmapModule.ConfigureServices, which this host runs
        // like every other module registration. Only the bridge onto the events channel is host-side,
        // because the channel is.
        services.AddSingleton<Mindmap.MindmapChangeBridge>();

        // 2. Shell services.
        // App-events channel: the fan-out the headless shell pushes toasts (and
        // later theme/navigation changes) through to reach the SPA over SSE.
        services.AddSingleton<AppEventHub>();
        services.AddSingleton<IAppEventPublisher>(sp => sp.GetRequiredService<AppEventHub>());
        services.AddSingleton<IAppEventSource>(sp => sp.GetRequiredService<AppEventHub>());

        // The window's closing handler and the SPA's reply endpoint meet here.
        services.AddSingleton<ShutdownGate>();

        // Likewise for the native file and folder choosers: registered whether or not a window
        // ever attaches, so the endpoint can answer "not here" instead of failing to resolve.
        services.AddSingleton<NativeFileDialogs>();

        // The destinations those choosers returned, which is the only thing the write route will
        // accept. Process-wide because the chooser and the upload are two separate requests.
        services.AddSingleton<ExportGrants>();

        // Gates the old-Avalonia-install warning behind its one-shot settings flag.
        services.AddSingleton<LegacyInstallWarning>();

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

        // 3. Modules: backend-side registrations only.
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
        // merged bundle in the same precedence order the registry built.
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
    /// Post-build startup work, with one ordering guarantee: the flashcard migration
    /// completes (or fails logged) before any endpoint can serve a read, and both
    /// SQLite stores are warmed so the first request never races schema creation.
    /// </summary>
    public static async Task InitializeBackendAsync(IServiceProvider services, IReadOnlyList<string> moduleDiscoveryFailures)
    {
        var logger = services.GetRequiredService<ILoggerService>();

        foreach (var failure in moduleDiscoveryFailures)
        {
            logger.Error("Mnemo.Host", $"Module discovery: {failure}");
        }

        // Replay the module sidebar registrations against the headless sidebar
        // service so the nav endpoint can serve them. These registrations are pure
        // metadata (labels, routes, icons), so unlike the other UI-side module hooks
        // they are safe to run in the host.
        var modules = services.GetRequiredService<IReadOnlyList<IModule>>();
        var sidebar = services.GetRequiredService<ISidebarService>();
        foreach (var module in modules)
        {
            module.RegisterSidebarItems(sidebar);
        }

        RegisterModuleWidgets(modules, services.GetRequiredService<IWidgetRegistry>(), services);

        // Load the saved UI language so server-emitted strings (e.g. the persisted chat trace)
        // resolve in the language the user chose rather than the default.
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
            // A failed migration must not brick startup; the store still
            // self-initializes a valid (empty) schema.
            logger.Error("Mnemo.Host", "Flashcard store migration failed during startup.", ex);
        }

        try
        {
            // After the import, because on the launch that imports it is the import that leaves the
            // evidence this reads. It is a single stored-key check on every later start.
            await services.GetRequiredService<IFlashcardFactlessCardRepair>()
                .RepairAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logger.Error("Mnemo.Host", "Repair of flashcards without material failed during startup.", ex);
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
    /// Replays the module widget registrations against the host's registry.
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
    /// would keep settingless, unsnapped widgets for good, because every later read finds a v2
    /// board and never migrates again.
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
