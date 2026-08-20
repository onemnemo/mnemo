using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Composition;
using Mnemo.Host.I18n;

namespace Mnemo.Host.Tests.I18n;

/// <summary>
/// The translation bundle the SPA is served, assembled through the host's own composition
/// root. Module translation sources are added by reflection over discovered modules, so one
/// that stops being registered breaks no build and fails no startup: the screens that read
/// it render their keys. A test that read the JSON off disk would keep passing across
/// exactly that change, which is the failure this type exists to expose.
/// </summary>
internal sealed class ServedTranslationBundle
{
    /// <summary>The cultures the product ships translations for.</summary>
    internal static readonly string[] Cultures = ["en", "de", "es", "ja", "nb"];

    private static readonly Lazy<IReadOnlyList<ITranslationSource>> ComposedSources = new(Compose);

    private readonly FailureLog _failures = new();
    private readonly TranslationBundleService _service;

    /// <summary>Serves from the given sources, starting with an empty cache.</summary>
    internal ServedTranslationBundle(IReadOnlyList<ITranslationSource> sources)
        => _service = new TranslationBundleService(sources, new StubLocalization(), _failures);

    /// <summary>
    /// The ordered sources a running host would serve from, resolved out of the real
    /// service registrations rather than restated here.
    /// </summary>
    internal static IReadOnlyList<ITranslationSource> RegisteredSources => ComposedSources.Value;

    /// <summary>
    /// A bundle over every registered source. The host caches each culture for the life of
    /// the process, so asking what the sources hold now means starting from a new service.
    /// </summary>
    internal static ServedTranslationBundle FromHostComposition() => new(RegisteredSources);

    /// <summary>
    /// What sources reported while building. The bundle service logs a source that throws
    /// and carries on without it, so this is the only trace of a namespace lost that way.
    /// </summary>
    internal IReadOnlyList<string> SourceFailures => _failures.Messages;

    /// <summary>The merged namespace to key to value bundle served for a culture.</summary>
    internal Task<IReadOnlyDictionary<string, Dictionary<string, string>>> LoadAsync(string culture)
        => _service.GetBundleAsync(culture);

    private static IReadOnlyList<ITranslationSource> Compose()
    {
        var modules = HostComposition.DiscoverModules(out var failures);
        if (failures.Count > 0)
            throw new InvalidOperationException("Module discovery failed: " + string.Join("; ", failures));

        var services = new ServiceCollection();
        HostComposition.AddMnemoBackend(services, modules);
        using var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IReadOnlyList<ITranslationSource>>();
    }

    /// <summary>Keeps what the bundle service swallows, so a failing test can report it.</summary>
    private sealed class FailureLog : ILoggerService
    {
        private readonly List<string> _messages = [];

        internal IReadOnlyList<string> Messages
        {
            get
            {
                lock (_messages)
                    return _messages.ToArray();
            }
        }

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            lock (_messages)
                _messages.Add(exception is null ? message : $"{message} ({exception.Message})");
        }
    }

    /// <summary>
    /// Stands in for the localization service, which the bundle service reaches for only to
    /// list the available languages. Nothing here asks it for that.
    /// </summary>
    private sealed class StubLocalization : ILocalizationService
    {
        public string CurrentLanguage => "en";
        public event EventHandler? LanguageChanged { add { } remove { } }
        public string GetString(string key, string? ns = null) => key;
        public string T(string key, string? ns = null) => key;
        public Task<bool> SetLanguageAsync(string languageCode, CancellationToken cancellationToken = default)
            => Task.FromResult(true);
        public Task<IEnumerable<LanguageManifest>> GetAvailableLanguagesAsync()
            => Task.FromResult<IEnumerable<LanguageManifest>>([]);
    }
}
