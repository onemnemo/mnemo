using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Mnemo.Infrastructure.Modules.Proofing;
using WeCantSpell.Hunspell;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Proofing;

/// <summary>
/// Dictionaries are third-party assets under their own licences, so what ships has to be exactly what
/// was downloaded from the recorded source. These tests hash the copies in the build output, which is
/// where the redistributed files come from, so an edited repository file fails here rather than
/// shipping.
/// </summary>
public sealed class ProofingDictionaryProvenanceTests
{
    private const string ProofingFolder = "Proofing";

    // The publish step drops any file whose relative path contains this. It is an ordinal substring
    // match, not a folder match, so a dictionary folder named anywhere below it would vanish from every
    // packaged build with no error at all.
    private const string TrimmedPublishPath = "Dictionaries/Spellcheck";

    private static string Root => Path.Combine(AppContext.BaseDirectory, "Dictionaries", ProofingFolder);

    private static JsonElement Manifest()
    {
        var path = Path.Combine(Root, "manifest.json");
        Assert.True(File.Exists(path), $"No dictionary manifest at {path}.");
        return JsonDocument.Parse(File.ReadAllText(path)).RootElement;
    }

    private static string Sha256(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    [Fact]
    public void EveryManifestFileIsPresentAndHashesToWhatWasRecorded()
    {
        var languages = Manifest().GetProperty("languages").EnumerateArray().ToArray();
        Assert.NotEmpty(languages);

        foreach (var language in languages)
        {
            var id = language.GetProperty("id").GetString()!;
            var directory = Path.Combine(Root, id);
            Assert.True(Directory.Exists(directory), $"No directory for {id}.");

            foreach (var file in language.GetProperty("files").EnumerateObject())
            {
                var path = Path.Combine(directory, file.Name);
                Assert.True(File.Exists(path), $"{id} is missing {file.Name}.");
                Assert.Equal(file.Value.GetString(), Sha256(path));
            }
        }
    }

    [Fact]
    public void EveryLanguageRecordsItsSourceArchiveAndLicence()
    {
        foreach (var language in Manifest().GetProperty("languages").EnumerateArray())
        {
            var id = language.GetProperty("id").GetString()!;

            var archive = language.GetProperty("archive");
            Assert.StartsWith("https://", archive.GetProperty("url").GetString()!, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(archive.GetProperty("version").GetString()), $"{id} has no version.");
            Assert.Equal(64, archive.GetProperty("sha256").GetString()!.Length);

            var license = language.GetProperty("license");
            Assert.False(string.IsNullOrWhiteSpace(license.GetProperty("name").GetString()), $"{id} has no licence name.");
            Assert.StartsWith("https://", license.GetProperty("url").GetString()!, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void EveryLanguageShipsTheLicenceTextItsTermsRequire()
    {
        foreach (var language in Manifest().GetProperty("languages").EnumerateArray())
        {
            var id = language.GetProperty("id").GetString()!;
            var licenseFile = language.GetProperty("licenseFile").GetString()!;

            var path = Path.Combine(Root, id, licenseFile);
            Assert.True(File.Exists(path), $"{id} does not ship {licenseFile}.");
            Assert.True(new FileInfo(path).Length > 0, $"{id}'s {licenseFile} is empty.");

            // The licence file has to be one of the hashed files, or nothing stops it drifting.
            Assert.True(
                language.GetProperty("files").TryGetProperty(licenseFile, out _),
                $"{id}'s {licenseFile} is not covered by a checksum.");
        }
    }

    [Fact]
    public void TheAffixFilesDeclareUtf8()
    {
        foreach (var language in Manifest().GetProperty("languages").EnumerateArray())
        {
            var id = language.GetProperty("id").GetString()!;
            var affix = language.GetProperty("files").EnumerateObject()
                .Single(f => f.Name.EndsWith(".aff", StringComparison.OrdinalIgnoreCase));

            var directives = File.ReadLines(Path.Combine(Root, id, affix.Name))
                .Where(line => line.StartsWith("SET ", StringComparison.Ordinal))
                .ToArray();

            // A dictionary declaring a code page the runtime cannot resolve loads with every accented
            // word flagged and nothing else visibly wrong.
            Assert.Equal("SET UTF-8", Assert.Single(directives).TrimEnd());
        }
    }

    [Fact]
    public void EveryBundledDictionaryLoadsWithNoAffixWarnings()
    {
        // CreateFromFiles is extremely lenient: it builds a usable word list out of a malformed affix
        // file without throwing and without logging, so the warning list is the only place a broken
        // dictionary announces itself. A code page it cannot resolve shows up here and nowhere else,
        // and the visible symptom would be every accented word flagged.
        foreach (var language in Manifest().GetProperty("languages").EnumerateArray())
        {
            var id = language.GetProperty("id").GetString()!;
            var files = language.GetProperty("files").EnumerateObject().Select(f => f.Name).ToArray();
            var affix = files.Single(f => f.EndsWith(".aff", StringComparison.OrdinalIgnoreCase));
            var words = files.Single(f => f.EndsWith(".dic", StringComparison.OrdinalIgnoreCase));

            var loaded = WordList.CreateFromFiles(
                Path.Combine(Root, id, words),
                Path.Combine(Root, id, affix));

            Assert.Empty(loaded.Affix.Warnings);
        }
    }

    [Fact]
    public void TheCatalogAgreesWithTheManifest()
    {
        var catalog = new ProofingDictionaryCatalog();
        var expected = Manifest().GetProperty("languages").EnumerateArray()
            .Select(l => l.GetProperty("id").GetString()!)
            .ToArray();

        Assert.Equal([.. expected.Order()], [.. catalog.InstalledLanguages.Order()]);
    }

    [Fact]
    public void AManifestThatCannotBeParsedLeavesACatalogWithNoLanguages()
    {
        // The catalog is a singleton that a settings route resolves, so a throw out of its constructor
        // answered every settings write with an internal error, not only the proofing ones.
        var folder = Path.Combine(Path.GetTempPath(), $"mnemo_proofing_{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        try
        {
            File.WriteAllText(Path.Combine(folder, "manifest.json"), "{\"languages\": [ {\"id\": ");

            var catalog = new ProofingDictionaryCatalog(folder);

            Assert.Empty(catalog.InstalledLanguages);
            // The languages that never ship files are unaffected, so the wire shape does not change.
            Assert.Equal(["de-DE", "nb-NO"], catalog.Entries.Select(e => e.Id).Order());
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public void AMissingManifestIsTreatedTheSameWay()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"mnemo_proofing_{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        try
        {
            var catalog = new ProofingDictionaryCatalog(folder);

            Assert.Empty(catalog.InstalledLanguages);
        }
        finally
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public void TheDictionaryFolderIsOutsideWhatThePublishStepTrims()
    {
        var relative = new List<string>();
        foreach (var language in Manifest().GetProperty("languages").EnumerateArray())
        {
            var id = language.GetProperty("id").GetString()!;
            relative.AddRange(language.GetProperty("files").EnumerateObject()
                .Select(f => $"Dictionaries/{ProofingFolder}/{id}/{f.Name}"));
        }

        Assert.NotEmpty(relative);
        Assert.All(relative, path => Assert.DoesNotContain(TrimmedPublishPath, path, StringComparison.Ordinal));
        Assert.All(relative, path => Assert.DoesNotContain(
            TrimmedPublishPath.Replace('/', '\\'), path, StringComparison.Ordinal));
    }
}
