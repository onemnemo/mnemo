using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

/// <summary>
/// Loads built-in translations from JSON embedded in the Infrastructure assembly.
/// Schema: { "NamespaceName": { "Key1": "Value1", ... } }.
/// </summary>
public class EmbeddedBuiltInTranslationSource : ITranslationSource
{
    private const string ResourcePrefix = "Mnemo.Infrastructure.Languages.";
    private readonly Assembly _assembly;
    private readonly Dictionary<string, IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> _cache = new();

    /// <summary>
    /// Creates a new source that reads from the Infrastructure assembly's embedded Languages.*.json resources.
    /// </summary>
    public EmbeddedBuiltInTranslationSource()
    {
        _assembly = typeof(EmbeddedBuiltInTranslationSource).Assembly;
    }

    /// <inheritdoc />
    public Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> GetTranslationsForCultureAsync(
        string cultureCode,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(GetTranslationsForCulture(cultureCode));
    }

    /// <summary>
    /// The same bundle, read synchronously. The resources live in memory, so nothing here waits on I/O,
    /// and a caller with no async path (a crash notice at startup) can use it without blocking on a task.
    /// </summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> GetTranslationsForCulture(string cultureCode)
    {
        if (string.IsNullOrEmpty(cultureCode))
            return new Dictionary<string, IReadOnlyDictionary<string, string>>();

        lock (_cache)
        {
            if (_cache.TryGetValue(cultureCode, out var cached))
                return cached;
        }

        var resourceName = ResourcePrefix + cultureCode + ".json";
        using var stream = _assembly.GetManifestResourceStream(resourceName);
        if (stream == null)
            return new Dictionary<string, IReadOnlyDictionary<string, string>>();

        var root = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(stream)
            ?? new Dictionary<string, Dictionary<string, string>>();
        var immutable = ToReadOnly(root);

        lock (_cache)
        {
            _cache[cultureCode] = immutable;
        }
        return immutable;
    }

    private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ToReadOnly(
        Dictionary<string, Dictionary<string, string>> dict)
    {
        var result = new Dictionary<string, IReadOnlyDictionary<string, string>>(dict.Count);
        foreach (var kv in dict)
        {
            result[kv.Key] = kv.Value != null ? new Dictionary<string, string>(kv.Value) : new Dictionary<string, string>();
        }
        return result;
    }
}
