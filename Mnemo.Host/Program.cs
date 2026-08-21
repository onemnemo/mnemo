using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Ai;
using Mnemo.Host.Chat;
using Mnemo.Host.Chrome;
using Mnemo.Host.Composition;
using Mnemo.Host.Contracts;
using Mnemo.Host.Events;
using Mnemo.Host.Flashcards;
using Mnemo.Host.I18n;
using Mnemo.Host.Keybinds;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Mindmap;
using Mnemo.Host.Nav;
using Mnemo.Host.Notes;
using Mnemo.Host.Overview;
using Mnemo.Host.Profile;
using Mnemo.Host.Settings;
using Mnemo.Host.Startup;
using Mnemo.Host.Statistics;
using Mnemo.Host.Trash;
using Mnemo.Host.Updates;
using Mnemo.Host.Web;
using Mnemo.Infrastructure.Common;
using Photino.NET;
using Velopack;

namespace Mnemo.Host;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        // First, before anything else runs: Velopack's install, update and uninstall hooks
        // execute inside this call and exit the process when one of them applies. Work done
        // ahead of it happens during those hooks too, and a shortcut, an uninstall or the
        // first applied update all depend on it being reached.
        VelopackApp.Build().Run();

        CrashLog.InstallProcessHandlers();

        try
        {
            return Run(args);
        }
        catch (Exception ex)
        {
            CrashLog.Write("Mnemo.Host could not start.", ex);
            FatalDialog.ShowStartupFailure(ex);
            return 1;
        }
    }

    private static int Run(string[] args)
    {
        if (OperatingSystem.IsLinux() && Environment.GetEnvironmentVariable("WEBKIT_DISABLE_DMABUF_RENDERER") is null)
        {
            // WebKitGTK's DMA-BUF renderer blanks windows on some Wayland/NVIDIA
            // stacks and PhotinoX's native layer does not handle it; disable it
            // proactively unless the user explicitly chose a value.
            Environment.SetEnvironmentVariable("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        var options = HostOptions.Parse(args);

        // Photino needs the window on this (STA) entry thread, so the async server
        // startup is bridged exactly once, here.
        var server = Task.Run(() => StartServerAsync(options)).GetAwaiter().GetResult();
        try
        {
            RunWindow(options, server);
            return 0;
        }
        finally
        {
            StopServer(server);
        }
    }

    private static void StopServer(ServerHandle server)
    {
        try
        {
            Task.Run(async () =>
            {
                await server.App.StopAsync().ConfigureAwait(false);
                await server.App.DisposeAsync().ConfigureAwait(false);
            }).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // This runs on the way out of a fault as often as a clean exit, and an
            // exception thrown here would replace the one already on its way up.
            CrashLog.Write("Mnemo.Host could not shut the server down cleanly.", ex);
        }
    }

    private sealed record ServerHandle(WebApplication App, string ApiBaseUrl, string WindowUrl, string SpellcheckLanguage);

    private static async Task<ServerHandle> StartServerAsync(HostOptions options)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            // Loopback only, never 0.0.0.0. Prod binds an ephemeral port; dev uses a
            // fixed port so the Vite proxy has a stable target across host restarts.
            kestrel.Listen(IPAddress.Loopback, options.DevMode ? options.DevApiPort : 0);
        });
        builder.Configuration["AllowedHosts"] = "localhost;127.0.0.1";
        builder.Logging.ClearProviders();

        var modules = HostComposition.DiscoverModules(out var discoveryFailures);
        HostComposition.AddMnemoBackend(builder.Services, modules);

        var app = builder.Build();
        var logger = app.Services.GetRequiredService<ILoggerService>();

        // From here on a fault has somewhere better to go than the file fallback, and
        // every line below reaches a packaged build's log rather than a console it has not
        // got.
        CrashLog.UseLogger(logger);

        var bearerToken = LocalApiSecurity.MintBearerToken();

        app.UseExceptionHandler(errorApp => errorApp.Run(async ctx =>
        {
            if (ctx.Features.Get<IExceptionHandlerFeature>()?.Error is { } error)
            {
                ctx.RequestServices.GetRequiredService<ILoggerService>()
                    .Error("Mnemo.Host", $"Unhandled error for {ctx.Request.Method} {ctx.Request.Path}.", error);
            }

            ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
            await ctx.Response.WriteAsJsonAsync(new ErrorDto("internal_error", "Unhandled server error.")).ConfigureAwait(false);
        }));
        app.UseLoopbackHostGuard();
        app.UseApiBearerToken(bearerToken, "/api/health");

        app.MapGet("/api/health", () => new HealthDto("ok"));
        app.MapGet("/api/app/info", (IUpdateService updates) => new AppInfoDto(updates.CurrentDisplayVersion));

        app.MapGet("/api/i18n/languages", (TranslationBundleService i18n) => i18n.GetLanguagesAsync());
        app.MapGet("/api/i18n/{culture}", (string culture, TranslationBundleService i18n, CancellationToken cancellationToken) =>
            i18n.GetBundleAsync(culture, cancellationToken));

        app.MapEventStream();
        app.MapLifecycle();
        app.MapSettings();
        app.MapProfileAssets();
        app.MapKeybinds();
        app.MapNav();
        app.MapSearch();
        app.MapChat();
        app.MapChatTurns();
        app.MapChatAssets();
        app.MapAi();
        app.MapFlashcardLibrary();
        app.MapFlashcardCards();
        app.MapFlashcardFacts();
        app.MapFlashcardAssets();
        app.MapFlashcardStudySessions();
        app.MapFlashcardTests();
        app.MapFlashcardPresets();
        app.MapFlashcardTransfer();
        app.MapNotes();
        app.MapNoteFolders();
        app.MapNoteAssets();
        app.MapNoteTransfer();
        app.MapNotePdf();
        app.MapMindmapLibrary();
        app.MapMindmapTemplates();
        app.MapMindmaps();
        app.MapMindmapAssets();
        app.MapMindmapTransfer();
        app.MapOverview();
        app.MapStatistics();
        app.MapTrash();
        app.MapUpdates();

        if (options.DevMode)
        {
            // Dev-only: poke the app-events channel end to end (server -> SSE -> SPA toast).
            app.MapPost("/api/dev/toast", (IToastService toasts) =>
            {
                toasts.SpawnToast(ToastType.Info, TimeSpan.FromSeconds(4), "Server toast",
                    "Pushed from Mnemo.Host over /api/events.");
                return Results.NoContent();
            });
        }

        if (!options.DevMode)
        {
            var spaRoot = ResolveSpaRoot(options);
            var templatedIndex = SpaHosting.LoadTemplatedIndex(spaRoot, bearerToken);
            SpaHosting.MapSpa(app, spaRoot, templatedIndex);
            logger.Info(CrashLog.Category, $"Serving SPA from {spaRoot}");
        }

        // Migration and storage warm-up complete before Kestrel accepts a request,
        // preserving the ordering guarantee the Avalonia app enforces at startup.
        await HostComposition.InitializeBackendAsync(app.Services, discoveryFailures).ConfigureAwait(false);

        // Resolved here, on the async startup path. Bridging it onto Photino's STA
        // thread with a Task.Run/GetResult in RunWindow blocks window creation on a
        // settings read. The service provider is already live at this point, so the
        // resolved value rides along on ServerHandle.
        var language = await app.Services.GetRequiredService<ISettingsService>()
            .GetAsync("Editor.SpellCheckLanguages", "en").ConfigureAwait(false);
        var spellcheckLanguage = string.IsNullOrWhiteSpace(language) ? "en" : language;

        await app.StartAsync().ConfigureAwait(false);

        // A quit or crash skips the on-close cleanup, so every launch collects what got left
        // behind. Backgrounded so startup never waits on it; the sweeper defers itself the
        // moment an editing session opens.
        app.Services.GetRequiredService<Notes.NoteAssets>().Sweeper.SweepInBackground();
        // Maps have no session to close, so this is their only sweep: no client has loaded yet,
        // which is the one moment nothing can undo a delete back into a reference.
        app.Services.GetRequiredService<Mindmap.MindmapAssets>().Sweeper.SweepInBackground();
        // Reconciles the trash against what the modules actually hold, then keeps expiry and the
        // file cleanup queue moving. Backgrounded because the routes gate themselves on it, so
        // nothing needs the window to wait.
        app.Services.GetRequiredService<TrashMaintenance>().StartInBackground();

        var apiBaseUrl = ResolveBoundAddress(app);
        logger.Info(CrashLog.Category, $"API listening on {apiBaseUrl}");

        if (options.DevMode)
        {
            var infoPath = DevServerInfo.Write(new Uri(apiBaseUrl).Port, bearerToken);
            if (infoPath is null)
                logger.Warning(CrashLog.Category, "Could not locate mnemo-web to write .dev/api.json; set MNEMO_DEV_INFO_FILE. Proxied API calls will be unauthorized.");
            else
                logger.Info(CrashLog.Category, $"Dev API info written to {infoPath}");

            await WaitForDevServerAsync(options.DevServerUrl, logger).ConfigureAwait(false);
        }

        var windowUrl = options.DevMode ? options.DevServerUrl : apiBaseUrl + "/";
        logger.Info(CrashLog.Category,
            $"MODE={(options.DevMode ? "DEV" : "PROD")} API_BASE={apiBaseUrl} WINDOW_URL={windowUrl}");
        return new ServerHandle(app, apiBaseUrl, windowUrl, spellcheckLanguage);
    }

    /// <summary>
    /// How long the window waits for the SPA to finish saving before closing
    /// anyway. Long enough for a note commit against a local SQLite file, short
    /// enough that nobody reads it as the app refusing to quit.
    /// </summary>
    private static readonly TimeSpan ShutdownGrace = TimeSpan.FromSeconds(3);

    private static void RunWindow(HostOptions options, ServerHandle server)
    {
        var url = server.WindowUrl;
        var logger = server.App.Services.GetRequiredService<ILoggerService>();

        var app = new PhotinoApplication();
        var bounds = WindowSizing.Resolve();

        var window = new PhotinoWindow()
            .SetTitle("Mnemo")
            .SetUseOsDefaultSize(false)
            .SetSize(bounds.Width, bounds.Height)
            .SetMinSize(bounds.MinWidth, bounds.MinHeight)
            .Center();

        if (OperatingSystem.IsWindows())
        {
            // Keep the WebView2 profile inside Mnemo's data root (which honors
            // MNEMO_DATA_DIR) instead of PhotinoX's default %LOCALAPPDATA%\Photino.
            var userDataFolder = Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "webview");
            window.SetUserDataFolder(userDataFolder);
            WebViewSpellcheck.Apply(userDataFolder, server.SpellcheckLanguage, logger);
        }

        WindowChrome.Configure(window, logger);
        AttachShutdownGate(window, server.App.Services);
        server.App.Services.GetRequiredService<NativeFolderPicker>().Attach(window);

        logger.Info(CrashLog.Category, $"Load({url})");
        window.Load(url);

        // Run shows the window and owns the message loop. Calling Show() first would
        // both double-create and, on Windows, trip Run's refusal to move an already
        // initialized window onto the STA thread it spins up.
        app.Run(window);
    }

    /// <summary>
    /// Holds the first close request open long enough for the SPA to save.
    /// </summary>
    /// <remarks>
    /// The handler returns immediately and does the waiting on a background
    /// thread. It runs on the UI thread, and the message loop it would otherwise
    /// block is the same one the WebView needs in order to run the save being
    /// waited for - blocking here would deadlock against the thing it is for.
    /// </remarks>
    private static void AttachShutdownGate(PhotinoWindow window, IServiceProvider services)
    {
        var gate = services.GetRequiredService<ShutdownGate>();
        var events = services.GetRequiredService<IAppEventPublisher>();
        var logger = services.GetRequiredService<ILoggerService>();

        window.RegisterClosingHandler((_, e) =>
        {
            // Only the first request is held. A second press of the close button
            // means the user is done waiting, and the close we ask for ourselves
            // below arrives through this same handler.
            if (!gate.TryBeginDrain())
                return;

            e.Cancel = true;
            events.Publish(new AppEvent("shutdown", new { graceMs = (int)ShutdownGrace.TotalMilliseconds }));

            _ = Task.Run(async () =>
            {
                var verdict = await gate.WaitForVerdictAsync(ShutdownGrace).ConfigureAwait(false);

                if (verdict == ShutdownVerdict.Cancelled)
                {
                    // Re-armed rather than left claimed: the window is still open, and a
                    // drain that stays spent would let the next close through with no
                    // save and no prompt.
                    gate.Reset();
                    return;
                }

                if (verdict == ShutdownVerdict.TimedOut)
                    logger.Warning(CrashLog.Category, "No client answered before the shutdown grace expired; closing anyway.");

                window.Invoke(window.Close);
            });
        });
    }

    private static string ResolveBoundAddress(WebApplication app)
    {
        var addresses = app.Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()?.Addresses;
        var address = addresses?.FirstOrDefault()
            ?? throw new InvalidOperationException("Kestrel reported no bound address.");

        // Kestrel reports the wildcard-normalized form; pin it back to the loopback name.
        return address.Replace("[::]", "127.0.0.1").Replace("0.0.0.0", "127.0.0.1").TrimEnd('/');
    }

    private static string ResolveSpaRoot(HostOptions options)
    {
        if (!string.IsNullOrWhiteSpace(options.SpaRootOverride))
            return Path.GetFullPath(options.SpaRootOverride);

        var defaultRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        if (Directory.Exists(defaultRoot))
            return defaultRoot;

        throw new InvalidOperationException(
            "No SPA to serve. Build mnemo-web and set MNEMO_SPA_ROOT to its dist folder (or publish it as wwwroot next to the executable), or run with --dev.");
    }

    private static async Task WaitForDevServerAsync(string url, ILoggerService logger)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(60);
        var reported = false;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                // Any response at all means the dev server is up.
                using var response = await http.GetAsync(url).ConfigureAwait(false);
                return;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
            }

            if (!reported)
            {
                logger.Info(CrashLog.Category, $"Waiting for the Vite dev server at {url} (npm run dev in mnemo-web)...");
                reported = true;
            }

            await Task.Delay(500).ConfigureAwait(false);
        }

        logger.Warning(CrashLog.Category, $"Dev server at {url} not reachable after 60s; opening the window anyway.");
    }
}
