using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// In-memory <see cref="IStorageProvider"/> that round-trips values through JSON exactly like
/// the SQLite provider, including its "Key not found" failure sentinel for absent keys.
/// </summary>
internal sealed class InMemoryStorageProvider : IStorageProvider
{
    private readonly Dictionary<string, string> _store = new(StringComparer.Ordinal);

    public IReadOnlyDictionary<string, string> Raw => _store;

    public void Seed(string key, string json) => _store[key] = json;

    public Task<Result> SaveAsync<T>(string key, T data)
    {
        _store[key] = JsonSerializer.Serialize(data);
        return Task.FromResult(Result.Success());
    }

    public Task<Result<T?>> LoadAsync<T>(string key)
    {
        if (!_store.TryGetValue(key, out var json))
            return Task.FromResult(Result<T?>.Failure("Key not found"));

        try
        {
            return Task.FromResult(Result<T?>.Success(JsonSerializer.Deserialize<T>(json)));
        }
        catch (JsonException ex)
        {
            // Mirrors the SQLite provider, which converts deserialization failures into Result failures.
            return Task.FromResult(Result<T?>.Failure($"Failed to load data for key: {key}", ex));
        }
    }

    public Task<Result> DeleteAsync(string key)
    {
        _store.Remove(key);
        return Task.FromResult(Result.Success());
    }
}
