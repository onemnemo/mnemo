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
using Mnemo.Host.Nav;
using Mnemo.Host.Notes;
using Mnemo.Host.Overview;
using Mnemo.Host.Settings;
using Mnemo.Host.Statistics;
using Mnemo.Host.Web;
using Mnemo.Infrastructure.Common;
using Photino.NET;

namespace Mnemo.Host;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
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
            Task.Run(async () =>
            {
                await server.App.StopAsync().ConfigureAwait(false);
                await server.App.DisposeAsync().ConfigureAwait(false);
            }).GetAwaiter().GetResult();
        }
    }

    private sealed record ServerHandle(WebApplication App, string ApiBaseUrl, string WindowUrl);

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
        app.MapKeybinds();
        app.MapNav();
        app.MapChat();
        app.MapChatTurns();
        app.MapChatAssets();
        app.MapAi();
        app.MapFlashcardLibrary();
        app.MapFlashcardCards();
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
        app.MapOverview();
app.MapStatistics();

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
            Console.WriteLine($"[Mnemo.Host] Serving SPA from {spaRoot}");
        }

        // Migration and storage warm-up complete before Kestrel accepts a request,
        // preserving the ordering guarantee the Avalonia app enforces at startup.
        await HostComposition.InitializeBackendAsync(app.Services, discoveryFailures).ConfigureAwait(false);
        await app.StartAsync().ConfigureAwait(false);

        // A quit or crash skips the on-close cleanup, so every launch collects what got left
        // behind. Backgrounded so startup never waits on it; the sweeper defers itself the
        // moment an editing session opens.
        app.Services.GetRequiredService<Notes.NoteAssets>().Sweeper.SweepInBackground();

        var apiBaseUrl = ResolveBoundAddress(app);
        Console.WriteLine($"[Mnemo.Host] API listening on {apiBaseUrl}");

        if (options.DevMode)
        {
            var infoPath = DevServerInfo.Write(new Uri(apiBaseUrl).Port, bearerToken);
            Console.WriteLine(infoPath is null
                ? "[Mnemo.Host] WARNING: could not locate mnemo-web to write .dev/api.json; set MNEMO_DEV_INFO_FILE. Proxied API calls will be unauthorized."
                : $"[Mnemo.Host] Dev API info written to {infoPath}");
            await WaitForDevServerAsync(options.DevServerUrl).ConfigureAwait(false);
        }

        var windowUrl = options.DevMode ? options.DevServerUrl : apiBaseUrl + "/";
        Console.WriteLine($"[Mnemo.Host] MODE={(options.DevMode ? "DEV" : "PROD")}");
        Console.WriteLine($"[Mnemo.Host] API_BASE={apiBaseUrl}");
        Console.WriteLine($"[Mnemo.Host] WINDOW_URL={windowUrl}");
        return new ServerHandle(app, apiBaseUrl, windowUrl);
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

        var app = new PhotinoApplication();

        var window = new PhotinoWindow()
            .SetTitle("Mnemo")
            .SetUseOsDefaultSize(false)
            .SetSize(1440, 900)
            .Center();

        if (OperatingSystem.IsWindows())
        {
            // Keep the WebView2 profile inside Mnemo's data root (which honors
            // MNEMO_DATA_DIR) instead of PhotinoX's default %LOCALAPPDATA%\Photino.
            var userDataFolder = Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "webview");
            window.SetUserDataFolder(userDataFolder);
            ApplySpellcheckLanguage(userDataFolder, server.App.Services);
        }

        WindowChrome.Configure(window);
        AttachShutdownGate(window, server.App.Services);

        Console.WriteLine($"[Mnemo.Host] Load({url})");
        window.Load(url);

        // Run shows the window and owns the message loop. Calling Show() first would
        // both double-create and, on Windows, trip Run's refusal to move an already
        // initialized window onto the STA thread it spins up.
        app.Run(window);
    }

    /// <summary>
    /// Configures the WebView profile's spell checker from the saved editor
    /// setting, before the window (and the WebView) is created.
    /// </summary>
    /// <remarks>
    /// The settings read is bridged here for the same reason the server startup
    /// is: this is Photino's STA thread and the window may not be created off it.
    /// </remarks>
    private static void ApplySpellcheckLanguage(string userDataFolder, IServiceProvider services)
    {
        var settings = services.GetRequiredService<ISettingsService>();
        var logger = services.GetRequiredService<ILoggerService>();
        var language = Task.Run(() => settings.GetAsync("Editor.SpellCheckLanguages", "en"))
            .GetAwaiter().GetResult();
        WebViewSpellcheck.Apply(userDataFolder, string.IsNullOrWhiteSpace(language) ? "en" : language, logger);
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
                var ready = await gate.WaitForReadyAsync(ShutdownGrace).ConfigureAwait(false);
                if (!ready)
                    Console.WriteLine("[Mnemo.Host] No client reported ready before the shutdown grace expired; closing anyway.");
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

    private static async Task WaitForDevServerAsync(string url)
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
                Console.WriteLine($"[Mnemo.Host] Waiting for the Vite dev server at {url} (npm run dev in mnemo-web)...");
                reported = true;
            }

            await Task.Delay(500).ConfigureAwait(false);
        }

        Console.WriteLine($"[Mnemo.Host] Dev server at {url} not reachable after 60s; opening the window anyway.");
    }
}
