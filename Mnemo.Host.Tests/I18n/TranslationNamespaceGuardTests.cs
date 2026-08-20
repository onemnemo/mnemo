using System.Text;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Xunit.Sdk;

namespace Mnemo.Host.Tests.I18n;

/// <summary>
/// Pins the translation namespaces the host serves. Every module source is registered by
/// reflection, so losing one is silent: nothing fails to compile, the endpoint still answers,
/// and the only symptom is screens rendering identifiers where words belong. Moving a
/// registration is on the near horizon, so the inventory below is checked in rather than
/// derived, and a namespace leaving it is a regression. A namespace joining it is a new
/// surface and needs the list extended by hand.
/// </summary>
public sealed class TranslationNamespaceGuardTests
{
    private static readonly string[] ServedNamespaces =
    [
        "App",
        "Chat",
        "Common",
        "EmojiPicker",
        "FlashcardMemory",
        "FlashcardStats",
        "FlashcardTests",
        "Flashcards",
        "GlobalSearch",
        "Hardware",
        "Keybinds",
        "Mindmap",
        "Notes",
        "NotesEditor",
        "Onboarding",
        "Overview",
        "Permissions",
        "RecentDecks",
        "RecentNotes",
        "Settings",
        "Sidebar",
        "StudyGoals",
        "Topbar",
        "TransferWarnings",
        "Trash",
        "UsageSummary",
        "WidgetActivity",
        "WidgetConfig",
        "WidgetDeck",
        "WidgetForecast",
        "WidgetGoals",
        "WidgetLeeches",
        "WidgetLibrary",
        "WidgetRecent",
        "WidgetRetention",
        "WidgetSoma",
        "WidgetStreak",
        "WidgetToday",
    ];

    [Theory]
    [InlineData("en")]
    [InlineData("de")]
    [InlineData("es")]
    [InlineData("ja")]
    [InlineData("nb")]
    public async Task EveryPinnedNamespaceReachesTheCulture(string culture)
    {
        var bundle = ServedTranslationBundle.FromHostComposition();

        AssertNothingLost(culture, await bundle.LoadAsync(culture), bundle.SourceFailures);
    }

    [Fact]
    public async Task TheGuardCatchesTheModuleSourcesGoingAway()
    {
        // The module namespaces reach the SPA only because the host can still see the
        // assembly the modules live in. Keeping the built-in source alone is what that
        // assembly going away looks like from here.
        var builtInOnly = ServedTranslationBundle.RegisteredSources
            .Where(source => source is EmbeddedBuiltInTranslationSource)
            .ToList();
        Assert.NotEmpty(builtInOnly);
        Assert.True(builtInOnly.Count < ServedTranslationBundle.RegisteredSources.Count);

        var bundle = new ServedTranslationBundle(builtInOnly);
        var served = await bundle.LoadAsync("en");

        var failure = Assert.ThrowsAny<XunitException>(
            () => AssertNothingLost("en", served, bundle.SourceFailures));

        // The namespaces with no second source to fall back on.
        string[] moduleOnly =
        [
            "FlashcardMemory", "FlashcardStats", "FlashcardTests", "Flashcards",
            "RecentDecks", "RecentNotes", "StudyGoals", "UsageSummary",
        ];
        foreach (var ns in moduleOnly)
            Assert.Contains(ns + " (absent)", failure.Message, StringComparison.Ordinal);
        Assert.Contains($"lost {moduleOnly.Length} of the", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task NoRegisteredSourceIsRedundant()
    {
        // A namespace two sources both fill survives one of them being dropped, so the
        // inventory above cannot speak for those. Every source has to change the bundle it
        // is part of, or the guard is blind to whichever one does not.
        var all = ServedTranslationBundle.RegisteredSources;
        var whole = TranslationBundleFingerprint.Hash(
            await ServedTranslationBundle.FromHostComposition().LoadAsync("en"));

        var redundant = new List<int>();
        for (var dropped = 0; dropped < all.Count; dropped++)
        {
            var kept = new List<ITranslationSource>(all);
            kept.RemoveAt(dropped);
            var served = await new ServedTranslationBundle(kept).LoadAsync("en");
            if (string.Equals(TranslationBundleFingerprint.Hash(served), whole, StringComparison.Ordinal))
                redundant.Add(dropped);
        }

        Assert.True(
            redundant.Count == 0,
            $"Translation sources at positions {string.Join(", ", redundant)} of {all.Count} add nothing "
            + "the rest of them do not already serve, so dropping one would leave no trace here.");
    }

    private static void AssertNothingLost(
        string culture,
        IReadOnlyDictionary<string, Dictionary<string, string>> served,
        IReadOnlyList<string> sourceFailures)
    {
        var lost = new List<string>();
        foreach (var ns in ServedNamespaces)
        {
            if (!served.TryGetValue(ns, out var entries))
                lost.Add(ns + " (absent)");
            else if (entries.Count == 0)
                lost.Add(ns + " (no keys)");
        }

        if (lost.Count == 0)
            return;

        var report = new StringBuilder();
        report.AppendLine(
            $"Culture '{culture}' lost {lost.Count} of the {ServedNamespaces.Length} translation namespaces the host serves:");
        foreach (var entry in lost)
            report.AppendLine("  " + entry);
        report.AppendLine("Every screen reading one of these renders its keys instead of words.");
        report.AppendLine(
            "A namespace leaves the bundle when its source stops being registered in HostComposition.AddMnemoBackend.");
        foreach (var failure in sourceFailures)
            report.AppendLine("  a source failed while building: " + failure);

        Assert.Fail(report.ToString());
    }
}
