using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using Mnemo.Core.Enums;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Modules.Proofing;

/// <summary>One language the proofing surface knows about, bundled or not.</summary>
/// <param name="Id">BCP 47 tag, for example <c>en-US</c>.</param>
/// <param name="Name">The English name, carried so a client whose bundle has no entry for this
/// language still has a word to print rather than a key.</param>
/// <param name="Region">The English region name, empty when the language names no region.</param>
/// <param name="Installed">Whether the files are present, so a check for it can be attempted.</param>
/// <param name="Bundled">Whether the files ship with the application rather than being fetched.</param>
/// <param name="ReasonKey">Translation key explaining an absence. Null when the language is installed.</param>
/// <param name="AffixPath">Full path to the affix file, or null when the language is not installed.</param>
/// <param name="DictionaryPath">Full path to the word list, or null when the language is not installed.</param>
public sealed record ProofingDictionaryEntry(
    string Id,
    string Name,
    string Region,
    bool Installed,
    bool Bundled,
    ProofingLicense License,
    string? ReasonKey,
    string? AffixPath,
    string? DictionaryPath)
{
    /// <summary>Translation key for the name. Always set, whether or not a bundle carries it.</summary>
    public string NameKey => ProofingDictionaryCatalog.NameKeyFor(Id);

    /// <summary>Translation key for the region, or null when the language names no region.</summary>
    public string? RegionKey =>
        string.IsNullOrEmpty(Region) ? null : ProofingDictionaryCatalog.RegionKeyFor(Id);
}

/// <summary>
/// What dictionaries this build carries, read once from the manifest that ships beside them.
/// <para>
/// The manifest is the same file the provenance test hashes against, so a language cannot appear
/// here without its source, version and per-file checksums being recorded.
/// </para>
/// </summary>
public sealed class ProofingDictionaryCatalog
{
    /// <summary>Folder name under the application directory holding every bundled dictionary.</summary>
    public const string FolderName = "Proofing";

    private const string ManifestFileName = "manifest.json";

    // A language reaches the catalog through the manifest, which any build can add one to, so the
    // key that names it has to follow from its tag rather than be written down beside the words.
    private const string NamePrefix = "proofing.language.name.";

    private const string RegionPrefix = "proofing.language.region.";

    private const string LogCategory = "Proofing";

    private static readonly JsonSerializerOptions ManifestJson = new(JsonSerializerDefaults.Web);

    // Languages the settings page must be able to list even though no files ship for them, so the
    // wire shape stays the same on the day one of them is added.
    private static readonly ProofingDictionaryEntry[] NotBundled =
    [
        new("de-DE", "German", "Germany", Installed: false, Bundled: false,
            new ProofingLicense("GPLv2 or GPLv3", "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html"),
            "proofing.language.notAvailableYet", null, null),
        new("nb-NO", "Norwegian Bokmal", "Norway", Installed: false, Bundled: false,
            new ProofingLicense("CC BY 4.0 and GPLv2", "https://creativecommons.org/licenses/by/4.0/"),
            "proofing.language.notAvailableYet", null, null),
        // Japanese is a different answer from the two above: they are dictionaries that have not been
        // bundled yet, this is one that cannot exist. Hunspell has no way to express Japanese word
        // segmentation, so no dictionary for it exists in any distribution and none is coming. It is
        // listed so the settings page can say that rather than leave a gap someone tries to fill, and
        // it carries no licence because there is nothing to license.
        new("ja-JP", "Japanese", "Japan", Installed: false, Bundled: false,
            new ProofingLicense(string.Empty, string.Empty),
            "proofing.language.unsupportedByEngine", null, null),
    ];

    private readonly List<ProofingDictionaryEntry> _entries;

    public ProofingDictionaryCatalog(ILoggerService? logger = null)
        : this(Path.Combine(AppContext.BaseDirectory, "Dictionaries", FolderName), logger)
    {
    }

    /// <summary>Reads a specific folder, which is how the tests point at the repository copy.</summary>
    public ProofingDictionaryCatalog(string root, ILoggerService? logger = null)
    {
        Root = root;
        _entries = [.. ReadManifest(root, logger), .. NotBundled];
    }

    /// <summary>The directory the manifest and the per-language folders live in.</summary>
    public string Root { get; }

    /// <summary>Every language the surface reports, installed ones first.</summary>
    public IReadOnlyList<ProofingDictionaryEntry> Entries => _entries;

    /// <summary>The tags that can actually be checked.</summary>
    public IReadOnlyList<string> InstalledLanguages =>
        [.. _entries.Where(e => e.Installed).Select(e => e.Id)];

    /// <summary>The translation key naming one language. Derived from the tag, so it needs no manifest entry.</summary>
    public static string NameKeyFor(string id) => NamePrefix + id;

    /// <summary>The translation key naming one language's region.</summary>
    public static string RegionKeyFor(string id) => RegionPrefix + id;

    /// <summary>Looks up one language. Returns null when nothing in the catalog carries that tag.</summary>
    public ProofingDictionaryEntry? Find(string? id) =>
        string.IsNullOrWhiteSpace(id)
            ? null
            : _entries.FirstOrDefault(e => string.Equals(e.Id, id, StringComparison.OrdinalIgnoreCase));

    private static List<ProofingDictionaryEntry> ReadManifest(string root, ILoggerService? logger)
    {
        var manifestPath = Path.Combine(root, ManifestFileName);
        if (!File.Exists(manifestPath))
            return [];

        ManifestFile? manifest;
        try
        {
            manifest = JsonSerializer.Deserialize<ManifestFile>(File.ReadAllText(manifestPath), ManifestJson);
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            // This runs in the constructor of a singleton that a settings route resolves, so throwing
            // here would answer every settings write with an internal error, not only the proofing ones.
            // A manifest that cannot be read is the same situation as one that is not there: no
            // languages, and the status endpoint says so.
            logger?.Log(LogLevel.Error, LogCategory, $"The proofing dictionary manifest at '{manifestPath}' could not be read.", ex);
            return [];
        }

        var entries = new List<ProofingDictionaryEntry>();
        foreach (var language in manifest?.Languages ?? [])
        {
            if (string.IsNullOrWhiteSpace(language.Id))
                continue;

            var directory = Path.Combine(root, language.Id);
            var affix = language.Files.Keys.FirstOrDefault(f => f.EndsWith(".aff", StringComparison.OrdinalIgnoreCase));
            var words = language.Files.Keys.FirstOrDefault(f => f.EndsWith(".dic", StringComparison.OrdinalIgnoreCase));

            var affixPath = affix is null ? null : Path.Combine(directory, affix);
            var wordsPath = words is null ? null : Path.Combine(directory, words);
            var installed = affixPath is not null && wordsPath is not null
                && File.Exists(affixPath) && File.Exists(wordsPath);

            entries.Add(new ProofingDictionaryEntry(
                language.Id,
                language.Name ?? language.Id,
                language.Region ?? string.Empty,
                installed,
                Bundled: true,
                new ProofingLicense(language.License?.Name ?? string.Empty, language.License?.Url ?? string.Empty),
                installed ? null : "proofing.language.filesMissing",
                installed ? affixPath : null,
                installed ? wordsPath : null));
        }

        return entries;
    }

    private sealed class ManifestFile
    {
        [JsonPropertyName("languages")]
        public List<ManifestLanguage> Languages { get; init; } = [];
    }

    private sealed class ManifestLanguage
    {
        public string Id { get; init; } = string.Empty;
        public string? Name { get; init; }
        public string? Region { get; init; }
        public ManifestArchive? Archive { get; init; }
        public ProofingLicense? License { get; init; }
        public string? LicenseFile { get; init; }
        public Dictionary<string, string> Files { get; init; } = [];
    }

    private sealed class ManifestArchive
    {
        public string Url { get; init; } = string.Empty;
        public string Version { get; init; } = string.Empty;
        public string Sha256 { get; init; } = string.Empty;
        public long SizeBytes { get; init; }
    }
}
