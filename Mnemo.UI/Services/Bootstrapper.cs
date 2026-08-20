using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Updates;

using Mnemo.Core.History;
using Mnemo.Infrastructure.History;
using Mnemo.Infrastructure.Services.AI;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Mnemo.Infrastructure.Services.Notes;
using Mnemo.Infrastructure.Services.Notes.Pdf;
using Mnemo.Infrastructure.Services.Notes.Persistence;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Statistics;
using Mnemo.Infrastructure.Services.TextShortcuts;
using Mnemo.Infrastructure.Services.Keybinds;
using Mnemo.Infrastructure.Services.Tools;
using Mnemo.Infrastructure.Services.Packaging;
using Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;
using Mnemo.Infrastructure.Services.ImportExport;
using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Mnemo.Infrastructure.Services.Spellcheck;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.Infrastructure.Services.Widgets;
using Mnemo.Core.Services.Search;
using Mnemo.Core.Services.Ai;
using Mnemo.UI.Mcp;
using Mnemo.UI.Modules.Notes.Services;

namespace Mnemo.UI.Services;

public static class Bootstrapper
{
    public static IServiceProvider Build()
    {
        var services = new ServiceCollection();

        // 1. Register Core/Infrastructure Services
        services.AddSingleton<IHistoryManager, HistoryManager>();
        services.AddSingleton<ILoggerService, LoggerService>();
        services.AddSingleton<IStorageProvider, SqliteStorageProvider>();
        services.AddSingleton<IChatModuleHistoryService, ChatModuleHistoryService>();
        services.AddSingleton<IChatHistoryClearService, ChatHistoryClearService>();
        services.AddSingleton<ISettingsService, SettingsService>();
        services.AddSingleton<IPerfDiagnostics, PerfDiagnosticsService>();
        services.AddSingleton<IUpdateService, VelopackUpdateService>();
        services.AddSingleton<ILaTeXEngine, LaTeXEngine>();
        services.AddSingleton<IMarkdownProcessor, MarkdownProcessor>();
        services.AddSingleton<ITextMateSyntaxHighlighter, TextMateSyntaxHighlighter>();
        services.AddSingleton<IMarkdownRenderer, MarkdownRenderer>();
        services.AddSingleton<INoteClipboardPayloadCodec, NoteClipboardPayloadCodec>();
        services.AddSingleton<INoteClipboardPlatformService, NoteClipboardPlatformService>();
        services.AddSingleton<IImageAssetService, ImageAssetService>();
        services.AddSingleton<ITextShortcutService, TextShortcutService>();
        services.AddSingleton<ISpellDictionaryCatalogService, SpellDictionaryCatalogService>();
        services.AddSingleton<IUserSpellbookService, UserSpellbookService>();
        services.AddSingleton<ISpellcheckService, HunspellSpellcheckService>();

        // ── Tool surface (skills + dispatcher; consumed in-process by the AI gateway) ─
        services.AddSingleton<ISkillRegistry, SkillRegistry>();
        services.AddSingleton<ISkillSystemPromptComposer, SkillSystemPromptComposer>();
        services.AddSingleton<IToolResultFormatter, ToolResultFormatter>();
        services.AddSingleton<IMainThreadDispatcher, AvaloniaMainThreadDispatcher>();
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

        // ── Conversation memory (in-process UI state only) ────────────────────
        services.AddSingleton<IConversationMemoryStore>(sp =>
            new ConversationMemoryStore(sp.GetRequiredService<ILoggerService>()));
        services.AddSingleton<IConversationSummarizer>(sp =>
            new ConversationSummarizer(sp.GetRequiredService<IAIOrchestrator>()));
        services.AddSingleton<IConversationMemoryInjector, ConversationMemoryInjector>();

        // ── MCP tool server (exposes Mnemo tools to external agents) ─
        services.AddSingleton<MnemoMcpOptions>();
        services.AddSingleton<MnemoMcpServer>();

        // ── Mnemo AI stack: orchestrator + tool gateway over the v2 contracts ─
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

        services.AddSingleton<NoteCommitStore>();
        services.AddSingleton<INoteCommitStore>(sp => sp.GetRequiredService<NoteCommitStore>());
        services.AddSingleton<INoteTrashStore>(sp => sp.GetRequiredService<NoteCommitStore>());
        services.AddSingleton<INoteFolderStore>(sp => sp.GetRequiredService<NoteCommitStore>());
        services.AddSingleton<INoteSidMigrator, NoteSidMigrator>();
        services.AddSingleton<INoteService, NoteService>();
        services.AddSingleton<INoteFolderService, NoteFolderService>();
        // PDF export/preview via Typst (real vector math through mitex), replacing the QuestPDF path
        // and its Avalonia LaTeX rasterizer. Desktop image blocks store absolute paths, so the
        // direct-path locator resolves them the way the old composer's File.Exists did.
        services.AddSingleton(new TypstBinaryProvider());
        services.AddSingleton(sp => new TypstCompiler(sp.GetRequiredService<TypstBinaryProvider>()));
        services.AddSingleton<INotePdfExportService>(sp => new TypstNotePdfExportService(
            sp.GetRequiredService<TypstCompiler>(),
            DirectPathImageLocator.Instance));

        // Relational flashcard store (rehaul): owned store, repositories, and blob→relational migrator.
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
        services.AddSingleton<IFlashcardFactlessCardRepair, FlashcardFactlessCardRepair>();

        // Scheduling reads the time through this rather than the static properties, so day
        // boundaries stay one decision the tests can drive.
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<FlashcardClock>();

        // FSRS-only scheduler for the new engine.
        services.AddSingleton<IFsrsScheduler, FsrsScheduler>();

        // Focused flashcard services over the relational store.
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

        // 2. Register UI-specific Services
        services.AddSingleton<IThemeService, ThemeService>();
        services.AddSingleton<IOverlayService, OverlayService>();
        services.AddSingleton<ToastService>();
        services.AddSingleton<IToastService>(sp => sp.GetRequiredService<ToastService>());
        services.AddSingleton<IUIService, UIService>();
        
        services.AddSingleton<NavigationService>();
        services.AddSingleton<INavigationService>(sp => sp.GetRequiredService<NavigationService>());
        services.AddSingleton<INavigationRegistry>(sp => sp.GetRequiredService<NavigationService>());
        
        services.AddSingleton<SidebarService>();
        services.AddSingleton<ISidebarService>(sp => sp.GetRequiredService<SidebarService>());
        
        services.AddSingleton<IFunctionRegistry, FunctionRegistry>();
        services.AddSingleton<IWidgetRegistry, WidgetRegistry>();
        services.AddSingleton<IWidgetLayoutEngine, WidgetLayoutEngine>();
        services.AddSingleton<IOverviewLayoutStore, OverviewLayoutStore>();
        services.AddSingleton<IWidgetContext, WidgetContext>();

        // Statistics manager is shared by built-in modules, widgets, and extension tools.
        services.AddSingleton<IStatisticsManager, StatisticsManager>();
        services.AddSingleton<StatisticsToolService>();
        services.AddSingleton<NavigationStatisticsTracker>();
        services.AddSingleton<IGlobalSearchService, GlobalSearchService>();
        services.AddSingleton<ISearchProvider, NavigationSearchProvider>();

        // 3. Discover modules and register translation sources (before building provider)
        var discoverSw = Stopwatch.StartNew();
        var modules = DiscoverModules().ToList();
        var discoverMs = discoverSw.ElapsedMilliseconds;
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
        services.AddSingleton<IDateDisplayService, DateDisplayService>();

        // 4. Configure Modules
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
        services.AddSingleton<IKeybindActionRouter, KeybindActionRouter>();
        services.AddSingleton<IEditorKeybindDispatch, EditorKeybindDispatch>();
        services.AddSingleton<IBlockEditorClipboardKeybindDispatch, BlockEditorClipboardKeybindDispatch>();
        services.AddSingleton<IMindmapKeybindDispatch, MindmapKeybindDispatch>();

        var buildSpSw = Stopwatch.StartNew();
        var serviceProvider = services.BuildServiceProvider();
        var buildSpMs = buildSpSw.ElapsedMilliseconds;

        var logger = serviceProvider.GetRequiredService<ILoggerService>();
        var perf = serviceProvider.GetRequiredService<IPerfDiagnostics>();
        perf.RecordTiming("Startup", "DiscoverModules", discoverMs);
        perf.RecordTiming("Startup", "BuildServiceProvider", buildSpMs);
        using (perf.Measure("Startup", "Bootstrapper.pre-window"))
            perf.CaptureMemorySnapshot("after BuildServiceProvider");

        // One-shot legacy→relational flashcard import. This MUST complete before any consumer of the
        // new relational services performs its first read (the library page, overview widgets, and
        // search all resolve after Build() returns and NavigateTo runs), so it is awaited here rather
        // than fired-and-forgotten. The migrator initializes the store schema itself and is idempotent
        // (backup-key guard), so a real import happens only once; every later launch is a fast no-op.
        // The store uses ConfigureAwait(false) throughout, so blocking the startup thread cannot
        // deadlock. Any failure is logged and swallowed here: the schema still initialized, so the user
        // sees an empty library rather than a dead app, and the legacy blob is left intact for retry.
        using (perf.Measure("Startup", "FlashcardStoreMigration"))
        {
            try
            {
                serviceProvider.GetRequiredService<IFlashcardStoreMigrator>()
                    .MigrateAsync().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                logger.Error("Bootstrapper", "Flashcard store migration failed during startup.", ex);
            }
        }

        // One-shot sweep for collections an earlier build imported without giving their cards any
        // material. It runs after the import, because on the launch that imports it is the import
        // that leaves the evidence the sweep reads, and before the first read for the same reason
        // the import is: a card with no material cannot be buried and has nothing to edit. Every
        // later start is a single stored-key check.
        using (perf.Measure("Startup", "FlashcardFactlessCardRepair"))
        {
            try
            {
                serviceProvider.GetRequiredService<IFlashcardFactlessCardRepair>()
                    .RepairAsync().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                logger.Error("Bootstrapper", "Repair of flashcards without material failed during startup.", ex);
            }
        }

        // Blocking, and before anything reads a note: the sid backfill has to finish before the notes
        // module can assume every block is addressable. It is a fast no-op once complete.
        using (perf.Measure("Startup", "NoteSidMigration"))
        {
            try
            {
                serviceProvider.GetRequiredService<INoteSidMigrator>()
                    .MigrateAsync().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                logger.Error("Bootstrapper", "Note sid migration failed during startup.", ex);
            }
        }

        // Welcome-note seed: runs once on fresh install, fire-and-forget so DB I/O doesn't block startup.
        _ = Task.Run(async () =>
        {
            try
            {
                await WelcomeNoteFirstRunSeed.TrySeedIfNeededAsync(
                    serviceProvider.GetRequiredService<INoteService>(),
                    serviceProvider.GetRequiredService<IStorageProvider>(),
                    logger).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                logger.Error("Bootstrapper", "Welcome note seed failed.", ex);
            }
        });

        // 5. Load saved or default language
        _ = LoadSavedLanguageAsync(serviceProvider);

        // Tools + skill manifests load only when AI.EnableAssistant is on (see AiAssistantToolHost).
        _ = serviceProvider.GetRequiredService<IAiAssistantToolHost>();

        // 7. Register Routes, Sidebar Items, and Widgets (tools deferred to AiAssistantToolHost)
        var navRegistry = serviceProvider.GetRequiredService<INavigationRegistry>();
        var sidebarService = serviceProvider.GetRequiredService<ISidebarService>();
        var widgetRegistry = serviceProvider.GetRequiredService<IWidgetRegistry>();

        foreach (var module in modules)
        {
            var moduleName = module.GetType().Name;
            var regSw = Stopwatch.StartNew();
            module.RegisterRoutes(navRegistry);
            var routesMs = regSw.ElapsedMilliseconds;
            perf.RecordTiming("Startup", $"{moduleName}.RegisterRoutes", routesMs);

            regSw.Restart();
            module.RegisterSidebarItems(sidebarService);
            var sidebarMs = regSw.ElapsedMilliseconds;
            perf.RecordTiming("Startup", $"{moduleName}.RegisterSidebarItems", sidebarMs);

            regSw.Restart();
            module.RegisterWidgets(widgetRegistry, serviceProvider);
            var widgetsMs = regSw.ElapsedMilliseconds;
            perf.RecordTiming("Startup", $"{moduleName}.RegisterWidgets", widgetsMs);
        }

        perf.CaptureMemorySnapshot("after module registration");

        _ = serviceProvider.GetRequiredService<NavigationStatisticsTracker>();

        // Launch stats: write to SQLite in background, not on the hot startup path.
        _ = StatisticsRecorder.RecordAppLaunchAsync(
            serviceProvider.GetRequiredService<IStatisticsManager>(), logger);

        return serviceProvider;
    }

    private static async Task LoadSavedLanguageAsync(IServiceProvider serviceProvider)
    {
        var settings = serviceProvider.GetRequiredService<ISettingsService>();
        var loc = serviceProvider.GetRequiredService<ILocalizationService>();
        var savedLanguage = await settings.GetAsync<string>("App.Language", "en").ConfigureAwait(false);
        var languageToLoad = !string.IsNullOrWhiteSpace(savedLanguage) ? savedLanguage : "en";
        await loc.SetLanguageAsync(languageToLoad).ConfigureAwait(false);
    }

    private static IEnumerable<IModule> DiscoverModules()
    {
        // Scan Mnemo.* assemblies only; plugin assemblies can be loaded into the AppDomain before discovery.
        var assemblySet = new HashSet<Assembly>();
        foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
        {
            if (a.FullName?.StartsWith("Mnemo.", StringComparison.Ordinal) == true)
                assemblySet.Add(a);
        }

        // Startup can run before every Mnemo.* assembly is in the AppDomain; UI modules always live here.
        assemblySet.Add(typeof(Bootstrapper).Assembly);

        var moduleType = typeof(IModule);
        var foundModules = new List<IModule>(32);

        foreach (var assembly in assemblySet)
        {
            Type[] types;
            try
            {
                // GetExportedTypes is cheaper than GetTypes (skips internal/nested-private; all IModule impls are public).
                types = assembly.GetExportedTypes();
            }
            catch
            {
                continue;
            }

            foreach (var type in types)
            {
                if (type.IsInterface || type.IsAbstract) continue;
                if (!moduleType.IsAssignableFrom(type)) continue;

                try
                {
                    if (Activator.CreateInstance(type) is IModule module)
                        foundModules.Add(module);
                }
                catch
                {
                    // Module instantiation failures are ignored during discovery phase.
                }
            }
        }
        return foundModules;
    }
}


