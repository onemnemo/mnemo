using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Infrastructure.Tests.Localization;

/// <summary>
/// Guards the translation bundles. Every string a user reads comes from these files, the web UI
/// included, so a key present only in English, or a value whose placeholders drifted, is a defect
/// that shows up for one audience and nobody else. Nothing else checks them, and English copy has
/// already reached a release carrying punctuation the style rules forbid.
///
/// The bundles are read back out of the assembly manifest rather than off disk, so a file that
/// exists in the tree but never made it into an EmbeddedResource glob fails here as well.
/// Families are discovered rather than listed, so a new module or widget is covered the moment it
/// ships a Translations folder.
/// </summary>
public class TranslationBundleTests
{
    private const string English = "en";

    /// <summary>
    /// Figure dash, en dash, em dash and horizontal bar, none of which belong in copy. Spelled as
    /// escapes so the rule survives a tool that mangles this file's encoding.
    /// </summary>
    private static readonly Regex Dashes = new("[\u2012\u2013\u2014\u2015]", RegexOptions.Compiled);

    private static readonly Regex Placeholders = new(@"\{[^}]*\}", RegexOptions.Compiled);

    /// <summary>One culture's file, named the way the translation loaders name it.</summary>
    private sealed record Bundle(string Family, string Language, string Resource, Assembly Assembly)
    {
        public override string ToString() => Family + "." + Language;
    }

    [Fact]
    public void EveryFamily_ShipsTheSameSetOfLanguages()
    {
        var families = Families();
        var languages = families.SelectMany(family => family.Select(bundle => bundle.Language))
            .Distinct()
            .OrderBy(language => language, StringComparer.Ordinal)
            .ToList();

        var gaps = families
            .Select(family => new { family.Key, Missing = languages.Except(family.Select(b => b.Language)).ToList() })
            .Where(gap => gap.Missing.Count > 0)
            .Select(gap => $"{gap.Key} is missing {string.Join(", ", gap.Missing)}")
            .ToList();

        Assert.True(
            gaps.Count == 0,
            Explain("A language the app offers has no file here, so these surfaces fall back to English", gaps));
        Assert.Contains(English, languages);
    }

    [Fact]
    public void EveryLanguage_HasEveryKeyEnglishHas()
    {
        var gaps = CompareWithEnglish((bundle, english, translated) =>
        {
            var missing = Sorted(english.Keys.Except(translated.Keys));
            return missing.Count == 0 ? null : $"{bundle} is missing {missing.Count}: {Sample(missing)}";
        });

        Assert.True(gaps.Count == 0, Explain("Translate these keys, or drop them from English", gaps));
    }

    [Fact]
    public void NoLanguage_KeepsAKeyEnglishHasDropped()
    {
        var gaps = CompareWithEnglish((bundle, english, translated) =>
        {
            var orphans = Sorted(translated.Keys.Except(english.Keys));
            return orphans.Count == 0 ? null : $"{bundle} still has {orphans.Count}: {Sample(orphans)}";
        });

        Assert.True(
            gaps.Count == 0,
            Explain("Nothing can ask for a key English no longer declares, so remove these", gaps));
    }

    [Fact]
    public void NoValue_UsesADash()
    {
        var offenders = new List<string>();
        foreach (var bundle in Discover())
        {
            offenders.AddRange(Entries(bundle)
                .Where(entry => Dashes.IsMatch(entry.Value))
                .Select(entry => $"{bundle} {entry.Key}: {entry.Value}"));
        }

        Assert.True(offenders.Count == 0, Explain("Rewrite these with a comma, a colon or a full stop", offenders));
    }

    [Fact]
    public void EveryValue_KeepsThePlaceholdersEnglishUses()
    {
        var gaps = CompareWithEnglish((bundle, english, translated) =>
        {
            var mismatched = translated
                .Where(entry => english.TryGetValue(entry.Key, out var source)
                    && !NamesIn(source).SetEquals(NamesIn(entry.Value)))
                .Select(entry => $"{bundle} {entry.Key}: en has {Show(english[entry.Key])}, this has {Show(entry.Value)}")
                .ToList();
            return mismatched.Count == 0 ? null : string.Join(Environment.NewLine, mismatched);
        });

        Assert.True(
            gaps.Count == 0,
            Explain("A placeholder the runtime fills is missing or invented, which formats as a literal brace", gaps));
    }

    [Fact]
    public void NoValue_IsBlank()
    {
        var blanks = new List<string>();
        foreach (var bundle in Discover())
        {
            blanks.AddRange(Entries(bundle)
                .Where(entry => string.IsNullOrWhiteSpace(entry.Value))
                .Select(entry => $"{bundle} {entry.Key}"));
        }

        Assert.True(blanks.Count == 0, Explain("A blank value renders as nothing at all, so give it words", blanks));
    }

    [Fact]
    public void NoBundle_DeclaresAKeyTwice()
    {
        var repeats = new List<string>();
        foreach (var bundle in Discover())
        {
            repeats.AddRange(Entries(bundle)
                .GroupBy(entry => entry.Key)
                .Where(group => group.Count() > 1)
                .Select(group => $"{bundle} {group.Key} appears {group.Count()} times"));
        }

        Assert.True(repeats.Count == 0, Explain("The last one silently wins, so the others are dead edits", repeats));
    }

    [Fact]
    public void EveryBundle_IsNamespacesOfPlainStrings()
    {
        var wrong = new List<string>();
        foreach (var bundle in Discover())
        {
            using var document = Parse(bundle);
            foreach (var group in document.RootElement.EnumerateObject())
            {
                if (group.Value.ValueKind != JsonValueKind.Object)
                {
                    wrong.Add($"{bundle} {group.Name} is {group.Value.ValueKind}, not a namespace");
                    continue;
                }

                wrong.AddRange(group.Value.EnumerateObject()
                    .Where(entry => entry.Value.ValueKind != JsonValueKind.String)
                    .Select(entry => $"{bundle} {group.Name}/{entry.Name} is {entry.Value.ValueKind}, not a string"));
            }
        }

        Assert.True(wrong.Count == 0, Explain("The loaders read one level of namespaces holding strings", wrong));
    }

    /// <summary>
    /// Runs a check over every non-English bundle against the English one beside it. Families with
    /// no English bundle are left alone, since that is its own test's finding to report.
    /// </summary>
    private static List<string> CompareWithEnglish(
        Func<Bundle, Dictionary<string, string>, Dictionary<string, string>, string?> check)
    {
        var gaps = new List<string>();
        foreach (var family in Families())
        {
            var source = family.FirstOrDefault(bundle => bundle.Language == English);
            if (source is null)
                continue;

            var english = Map(source);
            foreach (var bundle in family.Where(candidate => candidate.Language != English))
            {
                var problem = check(bundle, english, Map(bundle));
                if (problem is not null)
                    gaps.Add(problem);
            }
        }

        return gaps;
    }

    private static List<IGrouping<string, Bundle>> Families() =>
        Discover().GroupBy(bundle => bundle.Family).OrderBy(family => family.Key, StringComparer.Ordinal).ToList();

    private static List<Bundle> Discover()
    {
        // Both the built-in bundle and every module and widget bundle are embedded here.
        var assembly = typeof(EmbeddedBuiltInTranslationSource).Assembly;

        var bundles = new List<Bundle>();
        foreach (var resource in assembly.GetManifestResourceNames())
        {
            if (!resource.EndsWith(".json", StringComparison.Ordinal))
                continue;
            if (!resource.Contains(".Languages.", StringComparison.Ordinal)
                && !resource.Contains(".Translations.", StringComparison.Ordinal))
                continue;

            // Both loaders build the name as family + "." + culture + ".json".
            var stem = resource[..^".json".Length];
            var split = stem.LastIndexOf('.');
            if (split <= 0)
                continue;

            bundles.Add(new Bundle(stem[..split], stem[(split + 1)..], resource, assembly));
        }

        Assert.NotEmpty(bundles);
        return bundles;
    }

    private static JsonDocument Parse(Bundle bundle)
    {
        using var stream = bundle.Assembly.GetManifestResourceStream(bundle.Resource);
        Assert.NotNull(stream);
        return JsonDocument.Parse(stream);
    }

    /// <summary>
    /// Flattens to "Namespace/Key". Non-string leaves are skipped rather than guessed at, so the
    /// shape test is the one that reports them.
    /// </summary>
    private static List<KeyValuePair<string, string>> Entries(Bundle bundle)
    {
        using var document = Parse(bundle);
        return document.RootElement.EnumerateObject()
            .Where(group => group.Value.ValueKind == JsonValueKind.Object)
            .SelectMany(group => group.Value.EnumerateObject()
                .Where(entry => entry.Value.ValueKind == JsonValueKind.String)
                .Select(entry => KeyValuePair.Create(group.Name + "/" + entry.Name, entry.Value.GetString()!)))
            .ToList();
    }

    private static Dictionary<string, string> Map(Bundle bundle)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in Entries(bundle))
            map[entry.Key] = entry.Value;
        return map;
    }

    /// <summary>Compared as a set, because a translation may reorder or repeat what it fills in.</summary>
    private static HashSet<string> NamesIn(string value) =>
        Placeholders.Matches(value).Select(match => match.Value).ToHashSet(StringComparer.Ordinal);

    private static string Show(string value) =>
        NamesIn(value).Count == 0 ? "none" : string.Join(" ", Sorted(NamesIn(value)));

    private static List<string> Sorted(IEnumerable<string> values) =>
        values.OrderBy(value => value, StringComparer.Ordinal).ToList();

    private static string Sample(List<string> values) =>
        string.Join(", ", values.Take(5)) + (values.Count > 5 ? ", ..." : string.Empty);

    private static string Explain(string fix, List<string> problems) =>
        fix + ":" + Environment.NewLine + string.Join(Environment.NewLine, problems);
}
