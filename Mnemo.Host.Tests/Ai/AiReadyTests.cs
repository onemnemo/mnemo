using System;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Services;
using Mnemo.Host.Ai;

namespace Mnemo.Host.Tests.Ai;

public sealed class AiReadyTests
{
    public static TheoryData<bool, bool, HttpStatusCode> AvailabilityCases => new()
    {
        { false, false, HttpStatusCode.NotFound },
        { false, true, HttpStatusCode.NotFound },
        { true, false, HttpStatusCode.NotFound },
        { true, true, HttpStatusCode.NoContent },
    };

    [Theory]
    [MemberData(nameof(AvailabilityCases))]
    public async Task RequiresBothAvailabilitySwitches(
        bool developerMode,
        bool assistantEnabled,
        HttpStatusCode expectedStatus)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        var settings = new MemorySettings()
            .Seed(AiAvailability.DeveloperModeKey, developerMode)
            .Seed(AiAvailability.EnabledKey, assistantEnabled);
        builder.Services.AddSingleton<ISettingsService>(settings);

        await using var app = builder.Build();
        app.MapPost("/assistant", () => Results.NoContent())
            .RequireAiAvailable();
        await app.StartAsync();

        using var response = await app.GetTestClient()
            .PostAsync("/assistant", null);

        Assert.Equal(expectedStatus, response.StatusCode);
    }

    private sealed class MemorySettings : ISettingsService
    {
        private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

        public event EventHandler<string>? SettingChanged;

        public MemorySettings Seed<T>(string key, T value)
        {
            _values[key] = value;
            return this;
        }

        public Task<T> GetAsync<T>(string key, T defaultValue = default!) =>
            Task.FromResult(_values.TryGetValue(key, out var value) && value is T typed ? typed : defaultValue);

        public Task SetAsync<T>(string key, T value)
        {
            _values[key] = value;
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string key) =>
            Task.FromResult(_values.TryGetValue(key, out var value) && value is not null);
    }
}
