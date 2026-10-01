using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mnemo.Infrastructure.Tests.Localization;

/// <summary>
/// Every transfer warning the backend can emit is a <c>TransferWarnings</c> translation key, never
/// English prose. This walks the actual source for every place a key is minted rather than keeping
/// a hand list here, so a key a later feature adds (a backup restore evidence dialog, an Anki
/// review-history import) is covered the moment it ships, with no edit to this test required.
/// </summary>
public class TransferWarningKeyCoverageTests
{
    private static readonly string[] Languages = ["en", "de", "es", "ja", "nb"];

    /// <summary>
    /// Matches the literal key argument at every place a warning is minted: the shared
    /// <c>TransferWarning.Of(...)</c> factory in Mnemo.Infrastructure, and the Host-side
    /// <c>TransferWarningDto</c> equivalents. A key built from anything but a literal (string
    /// concatenation, an interpolated value) would slip past this scan, which is why every call
    /// site in the product code passes one directly rather than through a variable.
    /// </summary>
    private static readonly Regex KeyLiteral = new(
        "(?:TransferWarning\\.Of|new TransferWarningDto)\\(\\s*\"(?<key>[A-Za-z0-9]+)\"",
        RegexOptions.Compiled);

    /// <summary>Both literal keys of a <c>TransferWarning.Counted(...)</c> pair.</summary>
    private static readonly Regex CountedKeyLiterals = new(
        "TransferWarning\\.Counted\\(\\s*\"(?<one>[A-Za-z0-9]+)\"\\s*,\\s*\"(?<many>[A-Za-z0-9]+)\"",
        RegexOptions.Compiled);

    private static readonly Regex CountedCall = new("TransferWarning\\.Counted\\(", RegexOptions.Compiled);

    [Fact]
    public void EveryEmittedWarningKey_ExistsInEveryLocale()
    {
        var root = RepositoryRoot();
        var keys = CollectKeys(Path.Combine(root, "Mnemo.Infrastructure"))
            .Concat(CollectKeys(Path.Combine(root, "Mnemo.Host")))
            .ToHashSet(StringComparer.Ordinal);

        // A scan that found nothing found a broken regex, not a codebase with no warnings.
        Assert.True(keys.Count > 20, $"Expected to find dozens of warning keys by scanning source, found {keys.Count}.");

        var languagesDirectory = Path.Combine(root, "Mnemo.Infrastructure", "Languages");
        var gaps = new List<string>();
        foreach (var language in Languages)
        {
            var path = Path.Combine(languagesDirectory, $"{language}.json");
            Assert.True(File.Exists(path), $"Expected a language file at {path}.");

            using var document = JsonDocument.Parse(File.ReadAllText(path));
            if (!document.RootElement.TryGetProperty("TransferWarnings", out var ns))
            {
                gaps.Add($"{language}.json has no TransferWarnings namespace");
                continue;
            }

            foreach (var key in keys.OrderBy(k => k, StringComparer.Ordinal))
            {
                if (!ns.TryGetProperty(key, out _))
                    gaps.Add($"{language}.json is missing TransferWarnings/{key}");
            }
        }

        Assert.True(gaps.Count == 0, "Translate these keys in every locale:" + Environment.NewLine + string.Join(Environment.NewLine, gaps));
    }

    [Fact]
    public void EveryCountedWarning_NamesItsPairAsLiterals_AndEveryLocaleHasBothKeys()
    {
        var root = RepositoryRoot();
        var files = SourceFiles(Path.Combine(root, "Mnemo.Infrastructure"))
            .Concat(SourceFiles(Path.Combine(root, "Mnemo.Host")))
            .Select(file => (Path: file, Text: File.ReadAllText(file)))
            .ToList();

        var unread = files.Where(file => UnreadCountedCalls(file.Text) > 0).Select(file => file.Path).ToList();
        Assert.True(unread.Count == 0, "Pass both keys of TransferWarning.Counted as string literals in:" + Environment.NewLine + string.Join(Environment.NewLine, unread));

        var pairs = files.SelectMany(file => PairsIn(file.Text)).Distinct().ToList();
        var gaps = new List<string>();
        foreach (var language in Languages)
        {
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "Mnemo.Infrastructure", "Languages", $"{language}.json")));
            var ns = document.RootElement.GetProperty("TransferWarnings");
            foreach (var (one, many) in pairs)
            {
                if (!ns.TryGetProperty(one, out _) || !ns.TryGetProperty(many, out _))
                    gaps.Add($"{language}.json lacks part of the pair TransferWarnings/{one} and {many}");
            }
        }

        Assert.True(gaps.Count == 0, "Translate both keys of these pairs:" + Environment.NewLine + string.Join(Environment.NewLine, gaps));
    }

    [Fact]
    public void CountedWarning_ContributesBothKeysOfItsPair()
    {
        var keys = KeysIn("TransferWarning.Counted(\"CardsAddedOne\", \"CardsAddedMany\", count)").ToList();

        Assert.Equal(["CardsAddedOne", "CardsAddedMany"], keys);
    }

    [Fact]
    public void CountedWarning_WithAKeyFromAVariable_IsReportedNotSkipped()
    {
        Assert.Equal(1, UnreadCountedCalls("TransferWarning.Counted(oneKey, \"CardsAddedMany\", count)"));
        Assert.Equal(0, UnreadCountedCalls("TransferWarning.Counted(\"CardsAddedOne\", \"CardsAddedMany\", count)"));
    }

    private static IEnumerable<string> SourceFiles(string sourceDirectory) =>
        Directory.EnumerateFiles(sourceDirectory, "*.cs", SearchOption.AllDirectories);

    private static IEnumerable<string> CollectKeys(string sourceDirectory) =>
        SourceFiles(sourceDirectory).SelectMany(file => KeysIn(File.ReadAllText(file)));

    private static IEnumerable<string> KeysIn(string text)
    {
        foreach (Match match in KeyLiteral.Matches(text))
            yield return match.Groups["key"].Value;

        foreach (var (one, many) in PairsIn(text))
        {
            yield return one;
            yield return many;
        }
    }

    private static IEnumerable<(string One, string Many)> PairsIn(string text) =>
        CountedKeyLiterals.Matches(text).Select(match => (match.Groups["one"].Value, match.Groups["many"].Value));

    /// <summary>Counted calls whose keys the literal scan cannot read, so their pair would go unchecked.</summary>
    private static int UnreadCountedCalls(string text) =>
        CountedCall.Matches(text).Count - CountedKeyLiterals.Matches(text).Count;

    /// <summary>
    /// The repository root, found relative to this file's own path rather than the working
    /// directory or the test's output folder, so a scratch OutDir used for a test run does not
    /// change where the scan looks.
    /// </summary>
    private static string RepositoryRoot([CallerFilePath] string here = "")
    {
        // <root>/Mnemo.Infrastructure.Tests/Localization/TransferWarningKeyCoverageTests.cs
        var localization = new DirectoryInfo(Path.GetDirectoryName(here)!);
        return localization.Parent!.Parent!.FullName;
    }
}
