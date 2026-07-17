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
using Mnemo.Host.Composition;
using Mnemo.Host.Contracts;
using Mnemo.Host.Events;
using Mnemo.Host.I18n;
using Mnemo.Host.Keybinds;
using Mnemo.Host.Nav;
using Mnemo.Host.Settings;
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
            RunWindow(options, server.WindowUrl);
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
        app.MapGet("/api/decks", async (IFlashcardLibraryService library, CancellationToken cancellationToken) =>
        {
            var decks = await library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
            return decks.Select(DeckSummaryDto.FromModel).ToList();
        });

        app.MapGet("/api/i18n/languages", (TranslationBundleService i18n) => i18n.GetLanguagesAsync());
        app.MapGet("/api/i18n/{culture}", (string culture, TranslationBundleService i18n, CancellationToken cancellationToken) =>
            i18n.GetBundleAsync(culture, cancellationToken));

        app.MapEventStream();
        app.MapSettings();
        app.MapKeybinds();
        app.MapNav();
        app.MapChat();
        app.MapChatTurns();
        app.MapAi();

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

    private static void RunWindow(HostOptions options, string url)
    {
        // Do not disable DevTools/context menu/zoom here, and do not enable
        // Transparent. PhotinoX 4.3.1/4.3.2 applies those settings *after* the
        // initial navigation and each one calls Reload(), which discards the
        // still-pending navigation and leaves a permanently blank window
        // (Photino.Windows.Browser.cpp, CompleteWebViewInitialization). Leaving
        // them at their defaults is the only working configuration until that is
        // fixed upstream; the window chrome pass revisits this.
        var window = new PhotinoWindow()
            .SetTitle("Mnemo")
            .SetUseOsDefaultSize(false)
            .SetSize(1440, 900)
            .Center();

        if (OperatingSystem.IsWindows())
        {
            // Keep the WebView2 profile inside Mnemo's data root (which honors
            // MNEMO_DATA_DIR) instead of PhotinoX's default %LOCALAPPDATA%\Photino.
            window.SetTemporaryFilesPath(Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "webview"));
        }

        Console.WriteLine($"[Mnemo.Host] Load({url})");
        window.Load(url);
        window.Show();
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
