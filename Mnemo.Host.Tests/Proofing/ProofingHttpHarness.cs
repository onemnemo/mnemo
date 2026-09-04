using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Proofing;
using Mnemo.Host.Proofing;
using Mnemo.Infrastructure.Modules.Proofing;

namespace Mnemo.Host.Tests.Proofing;

/// <summary>
/// The proofing routes through TestServer, over the real services and the dictionaries this build
/// carries. Routing, model binding and the JSON shape are what these tests are about, and a stubbed
/// service would agree with the handlers by construction.
/// </summary>
internal sealed class ProofingHttpHarness : IAsyncDisposable
{
    private readonly WebApplication _app;
    private HttpClient? _client;

    public ProofingHttpHarness(IProofingEngine? engine = null, TimeSpan? loadTimeout = null)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        Settings = new MemorySettings();
        builder.Services.AddSingleton<ISettingsService>(Settings);
        builder.Services.AddSingleton<ILoggerService, SilentLogger>();
        builder.Services.AddSingleton<ProofingDictionaryCatalog>();
        builder.Services.AddSingleton<IProofingEngine>(engine ?? new HunspellProofingEngine(new ProofingDictionaryCatalog(), new SilentLogger()));
        builder.Services.AddSingleton<IProofingEngineRegistry, ProofingEngineRegistry>();
        builder.Services.AddSingleton<IPersonalDictionaryService, PersonalDictionaryService>();
        builder.Services.AddSingleton<INoteIgnoreService, NoteIgnoreService>();
        builder.Services.AddSingleton<INoteLanguageService, NoteLanguageService>();
        builder.Services.AddSingleton<IProofingService, ProofingService>();

        _app = builder.Build();
        _app.MapProofing(loadTimeout);
    }

    /// <summary>The store behind both lists, so a test can read what a request persisted.</summary>
    public MemorySettings Settings { get; }

    public HttpClient Client => _client ?? throw new InvalidOperationException("Call StartAsync first.");

    public async Task<ProofingHttpHarness> StartAsync()
    {
        await _app.StartAsync().ConfigureAwait(false);
        _client = _app.GetTestClient();
        return this;
    }

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        await _app.DisposeAsync().ConfigureAwait(false);
    }

    internal sealed class SilentLogger : ILoggerService
    {
        public void Log(Core.Enums.LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }

    internal sealed class MemorySettings : ISettingsService
    {
        private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

        public event EventHandler<string>? SettingChanged;

        public MemorySettings Seed<T>(string key, T value)
        {
            _values[key] = value;
            return this;
        }

        public Task<T> GetAsync<T>(string key, T defaultValue = default!)
            => Task.FromResult(_values.TryGetValue(key, out var value) && value is T typed ? typed : defaultValue);

        public Task SetAsync<T>(string key, T value)
        {
            _values[key] = value;
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string key)
            => Task.FromResult(_values.TryGetValue(key, out var value) && value is not null);
    }

    /// <summary>An engine that never finishes loading, standing in for a word list still being read.</summary>
    internal sealed class NeverReadyEngine : IProofingEngine
    {
        public string Id => "never-ready";

        public IReadOnlyList<string> Languages => ["en-US"];

        public bool IsReady(string language) => false;

        public async ValueTask<IReadOnlyList<ProofingIssue>> CheckAsync(string language, string text, CancellationToken ct)
        {
            await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
            return [];
        }

        public ValueTask<IReadOnlyList<ProofingFix>> SuggestAsync(
            string language,
            ProofingIssue issue,
            string text,
            CancellationToken ct)
            => ValueTask.FromResult<IReadOnlyList<ProofingFix>>([]);
    }
}
