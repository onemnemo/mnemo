using System;
using System.Collections.Generic;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;
using Mnemo.Core.Services;

namespace Mnemo.UI.Mcp;

/// <summary>
/// Hosts an in-process Streamable-HTTP MCP server that exposes Mnemo's tool surface
/// to external MCP clients (Claude Desktop, CLIs, other agents). The in-app assistant
/// does not go through this server, it dispatches tools in-process via the AI gateway.
/// </summary>
/// <remarks>
/// <para>Binds exclusively to <c>127.0.0.1</c> (loopback). DNS rebinding attacks are
/// mitigated by allowing only <c>localhost</c> and <c>127.0.0.1</c> Host headers.</para>
/// <para>Bearer-token authentication is enforced when <see cref="MnemoMcpOptions.BearerToken"/>
/// is non-empty.</para>
/// <para>If the server exits unexpectedly the watch-loop restarts it automatically
/// after a short back-off, up to <see cref="MaxRestartAttempts"/> times.</para>
/// </remarks>
public sealed class MnemoMcpServer : IAsyncDisposable
{
    private const int MaxRestartAttempts = 5;
    private static readonly TimeSpan RestartDelay = TimeSpan.FromSeconds(3);

    private readonly IAiAssistantToolHost _toolHost;
    private readonly ISkillRegistry _skillRegistry;
    private readonly IToolDispatcher _toolDispatcher;
    private readonly ILoggerService _logger;
    private readonly MnemoMcpOptions _options;

    private CancellationTokenSource? _cts;
    private Task? _watchTask;
    private volatile bool _disposed;

    /// <summary>Whether the watch loop is currently running (set during the loop, not per-restart).</summary>
    public bool IsRunning => _watchTask is { IsCompleted: false };

    /// <summary>The configured port.</summary>
    public int Port => _options.Port;

    public MnemoMcpServer(
        IAiAssistantToolHost toolHost,
        ISkillRegistry skillRegistry,
        IToolDispatcher toolDispatcher,
        ILoggerService logger,
        MnemoMcpOptions options)
    {
        _toolHost = toolHost;
        _skillRegistry = skillRegistry;
        _toolDispatcher = toolDispatcher;
        _logger = logger;
        _options = options;
    }

    /// <summary>
    /// Ensures tools are loaded, then starts the Kestrel/MCP web application and
    /// a background restart-watch loop.
    /// </summary>
    public async Task StartAsync(CancellationToken ct = default)
    {
        if (_watchTask != null)
        {
            _logger.Warning("MnemoMcpServer", "Server already started; ignoring duplicate StartAsync.");
            return;
        }

        if (!_options.Enabled)
        {
            _logger.Info("MnemoMcpServer", "MCP server disabled by configuration; not starting.");
            return;
        }

        // Ensure module tools are registered and skill manifests loaded, regardless of
        // the AI assistant toggle. The MCP server must work even when the in-app
        // assistant is off.
        await _toolHost.EnsureLoadedAsync(ct).ConfigureAwait(false);

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _watchTask = WatchAndRestartAsync(_cts.Token);
    }

    /// <summary>Cancels the watch loop and disposes any running web application.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        if (_cts != null)
        {
            await _cts.CancelAsync().ConfigureAwait(false);
            _cts.Dispose();
            _cts = null;
        }

        if (_watchTask != null)
        {
            try { await _watchTask.ConfigureAwait(false); } catch { /* expected on cancel */ }
            _watchTask = null;
        }
    }

    // ── Restart watch loop ───────────────────────────────────────────────────────

    private async Task WatchAndRestartAsync(CancellationToken ct)
    {
        int restarts = 0;

        while (!ct.IsCancellationRequested)
        {
            if (restarts >= MaxRestartAttempts)
            {
                _logger.Error("MnemoMcpServer",
                    $"MCP server failed to stay up after {MaxRestartAttempts} restart attempts. Giving up.",
                    null!);
                return;
            }

            if (restarts > 0)
            {
                _logger.Warning("MnemoMcpServer",
                    $"Restarting MCP server (attempt {restarts}/{MaxRestartAttempts}) after {RestartDelay.TotalSeconds}s…");
                try
                {
                    await Task.Delay(RestartDelay, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }

            WebApplication? app = null;
            try
            {
                app = BuildApp();
                await app.StartAsync(ct).ConfigureAwait(false);

                int toolCount = _skillRegistry.GetAllEnabledManifestTools().Count;
                _logger.Info("MnemoMcpServer",
                    $"MCP tool server listening on http://127.0.0.1:{_options.Port}  " +
                    $"({toolCount} tool{(toolCount == 1 ? "" : "s")})");

                // Block until cancellation is requested (graceful shutdown).
                try
                {
                    await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    // Graceful shutdown, stop the app and exit the loop.
                    await app.StopAsync(CancellationToken.None).ConfigureAwait(false);
                    return;
                }

                _logger.Warning("MnemoMcpServer", "MCP server stopped unexpectedly; scheduling restart.");
                restarts++;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.Error("MnemoMcpServer", "MCP server threw during start/run.", ex);
                restarts++;
            }
            finally
            {
                if (app != null)
                {
                    try { await app.DisposeAsync().ConfigureAwait(false); } catch { /* ignore */ }
                }
            }
        }
    }

    // ── App construction ─────────────────────────────────────────────────────────

    private WebApplication BuildApp()
    {
        var tools = BuildServerTools();
        _logger.Info("MnemoMcpServer", $"Registering {tools.Count} MCP tools.");

        var builder = WebApplication.CreateBuilder();

        // Bind only to loopback, the DNS rebinding guard.
        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            kestrel.Listen(IPAddress.Loopback, _options.Port);
        });

        // Restrict Host headers to loopback values only.
        builder.WebHost.UseKestrel();
        builder.Configuration["AllowedHosts"] = "localhost;127.0.0.1";

        // Suppress Kestrel/ASP.NET Core startup noise from Mnemo's log.
        builder.Logging.ClearProviders();

        builder.Services
            .AddMcpServer()
            .WithHttpTransport(o => { o.Stateless = true; })
            .WithTools(tools);

        var app = builder.Build();

        // Host-header validation: allow only loopback hostnames to block DNS rebinding.
        app.Use(async (ctx, next) =>
        {
            string host = ctx.Request.Host.Host;
            if (!string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
                && host != "127.0.0.1")
            {
                ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            await next(ctx).ConfigureAwait(false);
        });

        // Optional bearer-token guard.
        if (!string.IsNullOrWhiteSpace(_options.BearerToken))
        {
            var expectedToken = "Bearer " + _options.BearerToken;
            app.Use(async (ctx, next) =>
            {
                if (!ctx.Request.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
                {
                    var auth = ctx.Request.Headers.Authorization.ToString();
                    if (!string.Equals(auth, expectedToken, StringComparison.Ordinal))
                    {
                        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return;
                    }
                }

                await next(ctx).ConfigureAwait(false);
            });
        }

        app.MapMcp();
        return app;
    }

    private List<McpServerTool> BuildServerTools()
    {
        var manifestTools = _skillRegistry.GetAllEnabledManifestTools();
        var list = new List<McpServerTool>(manifestTools.Count);

        foreach (var (_, def) in manifestTools)
        {
            if (string.IsNullOrWhiteSpace(def.Name))
            {
                continue;
            }

            var fn = new DispatcherAIFunction(def, _toolDispatcher);
            list.Add(McpServerTool.Create(fn));
        }

        return list;
    }
}
