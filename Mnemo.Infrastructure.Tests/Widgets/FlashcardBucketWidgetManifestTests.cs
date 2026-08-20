using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Modules.Overview;
using Mnemo.Infrastructure.Services.Widgets;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Verifies the three flashcard stat-bucket widgets (Memory / Test / Activity) register with
/// distinct ids/namespaces and that the pre-existing Activity widget kept its manifest id so
/// persisted board layouts survive the rework.
/// </summary>
public class FlashcardBucketWidgetManifestTests
{
    [Fact]
    public void ActivityWidget_KeepsLegacyManifestId()
    {
        Assert.Equal("mnemo.flashcard-stats", OverviewWidgetManifests.FlashcardStats.WidgetId);
    }

    [Fact]
    public void MemoryWidget_HasDistinctIdAndTranslationNamespace()
    {
        var manifest = OverviewWidgetManifests.FlashcardMemory;
        Assert.Equal("mnemo.flashcard-memory", manifest.WidgetId);
        Assert.Equal("FlashcardMemory", manifest.TranslationNamespace);
        Assert.Contains(new WidgetSize(1, 1), manifest.SupportedSizes);
        Assert.Contains(new WidgetSize(2, 1), manifest.SupportedSizes);
    }

    [Fact]
    public void TestWidget_HasDistinctIdAndTranslationNamespace()
    {
        var manifest = OverviewWidgetManifests.FlashcardTests;
        Assert.Equal("mnemo.flashcard-tests", manifest.WidgetId);
        Assert.Equal("FlashcardTests", manifest.TranslationNamespace);
        Assert.Contains(new WidgetSize(1, 1), manifest.SupportedSizes);
        Assert.Contains(new WidgetSize(2, 1), manifest.SupportedSizes);
    }

    [Fact]
    public void AllThreeBucketWidgets_RegisterWithDistinctIds()
    {
        var registry = new WidgetRegistry();
        registry.Register(new BuiltInWidgetDescriptor(OverviewWidgetManifests.FlashcardStats, null));
        registry.Register(new BuiltInWidgetDescriptor(OverviewWidgetManifests.FlashcardMemory, null));
        registry.Register(new BuiltInWidgetDescriptor(OverviewWidgetManifests.FlashcardTests, null));

        Assert.NotNull(registry.GetDescriptor("mnemo.flashcard-stats"));
        Assert.NotNull(registry.GetDescriptor("mnemo.flashcard-memory"));
        Assert.NotNull(registry.GetDescriptor("mnemo.flashcard-tests"));
    }
}
