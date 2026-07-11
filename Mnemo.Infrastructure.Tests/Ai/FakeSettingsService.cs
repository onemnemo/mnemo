using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>In-memory settings backed by a dictionary, returning the caller's default when a key is absent.</summary>
internal sealed class FakeSettingsService : ISettingsService
{
    private readonly Dictionary<string, object?> _values = new();

    public event EventHandler<string>? SettingChanged;

    public FakeSettingsService Set<T>(string key, T value)
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
}
