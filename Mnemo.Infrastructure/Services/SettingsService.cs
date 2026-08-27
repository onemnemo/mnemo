using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

public class SettingsService : ISettingsService
{
    private readonly IStorageProvider _storage;
    private readonly ConcurrentDictionary<string, object?> _cache = new();

    public event EventHandler<string>? SettingChanged;

    public SettingsService(IStorageProvider storage)
    {
        _storage = storage;
    }

    public async Task<T> GetAsync<T>(string key, T defaultValue = default!)
    {
        if (_cache.TryGetValue(key, out var cachedValue))
        {
            return cachedValue is T typedValue ? typedValue : defaultValue;
        }

        var result = await _storage.LoadAsync<T>(key).ConfigureAwait(false);

        // Do not treat success+false / success+0 as "missing": only JSON null / absent key uses default.
        if (!result.IsSuccess || result.Value is null)
            return defaultValue;

        _cache[key] = result.Value;
        return result.Value;
    }

    /// <summary>
    /// Checks for a stored key, including null values. Returns true on read failure to prevent
    /// default initialization from overwriting unreadable settings.
    /// </summary>
    public async Task<bool> ExistsAsync(string key)
    {
        if (_cache.TryGetValue(key, out var cached))
            return cached is not null;

        // Check existence without populating the typed cache with a JsonElement.
        var stored = await _storage.LoadAsync<object>(key).ConfigureAwait(false);
        if (stored.IsSuccess)
            return stored.Value is not null;

        return stored.Exception is not null;
    }

    /// <summary>
    /// Writes a setting, and throws if it did not reach storage.
    /// </summary>
    /// <remarks>
    /// The cache is filled and the event raised only once the write has actually landed.
    /// Doing either first reports a change that did not happen: the cache would answer
    /// reads with a value no restart could produce, and listeners would act on it. The
    /// API key row is the case that matters, where the difference is between being told
    /// the key is saved and finding out at the next launch that it is not.
    ///
    /// A throw rather than a returned failure because a lost write is not an outcome any
    /// caller has a sensible answer to, and it stops a request handler replying 200 to a
    /// write that vanished.
    /// </remarks>
    /// <exception cref="InvalidOperationException">The value could not be persisted.</exception>
    public async Task SetAsync<T>(string key, T value)
    {
        var result = await _storage.SaveAsync(key, value).ConfigureAwait(false);
        if (!result.IsSuccess)
        {
            throw new InvalidOperationException(
                result.ErrorMessage ?? $"Could not save the setting '{key}'.",
                result.Exception);
        }

        _cache[key] = value;
        SettingChanged?.Invoke(this, key);
    }
}

