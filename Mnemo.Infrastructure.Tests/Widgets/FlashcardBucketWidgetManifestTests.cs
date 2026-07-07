using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Services.Widgets;
using Mnemo.UI.Modules.Overview.Widgets.FlashcardMemory;
using Mnemo.UI.Modules.Overview.Widgets.FlashcardStats;
using Mnemo.UI.Modules.Overview.Widgets.FlashcardTests;

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
        var manifest = new FlashcardStatsWidgetDescriptor().Manifest;
        Assert.Equal("mnemo.flashcard-stats", manifest.WidgetId);
    }

    [Fact]
    public void MemoryWidget_HasDistinctIdAndTranslationNamespace()
    {
        var manifest = new FlashcardMemoryWidgetDescriptor().Manifest;
        Assert.Equal("mnemo.flashcard-memory", manifest.WidgetId);
        Assert.Equal("FlashcardMemory", manifest.TranslationNamespace);
        Assert.Contains(new WidgetSize(1, 1), manifest.SupportedSizes);
        Assert.Contains(new WidgetSize(2, 1), manifest.SupportedSizes);
    }

    [Fact]
    public void TestWidget_HasDistinctIdAndTranslationNamespace()
    {
        var manifest = new FlashcardTestsWidgetDescriptor().Manifest;
        Assert.Equal("mnemo.flashcard-tests", manifest.WidgetId);
        Assert.Equal("FlashcardTests", manifest.TranslationNamespace);
        Assert.Contains(new WidgetSize(1, 1), manifest.SupportedSizes);
        Assert.Contains(new WidgetSize(2, 1), manifest.SupportedSizes);
    }

    [Fact]
    public void AllThreeBucketWidgets_RegisterWithDistinctIds()
    {
        var registry = new WidgetRegistry();
        registry.Register(new FlashcardStatsWidgetDescriptor());
        registry.Register(new FlashcardMemoryWidgetDescriptor());
        registry.Register(new FlashcardTestsWidgetDescriptor());

        Assert.NotNull(registry.GetDescriptor("mnemo.flashcard-stats"));
        Assert.NotNull(registry.GetDescriptor("mnemo.flashcard-memory"));
        Assert.NotNull(registry.GetDescriptor("mnemo.flashcard-tests"));
    }
}
