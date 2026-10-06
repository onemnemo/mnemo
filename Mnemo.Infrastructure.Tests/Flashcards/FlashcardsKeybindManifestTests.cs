using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Mnemo.Infrastructure.Modules.Flashcards;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

public class FlashcardsKeybindManifestTests
{
    private static JsonElement KeybindLabels(string language)
    {
        var assembly = typeof(FlashcardsBackendModule).Assembly;
        using var stream = assembly.GetManifestResourceStream($"Mnemo.Infrastructure.Modules.Flashcards.Translations.{language}.json");
        Assert.NotNull(stream);
        return JsonDocument.Parse(stream).RootElement.GetProperty("Keybinds").Clone();
    }

    [Fact]
    public void EveryActionIsUniqueAndNamedUnderItsNamespace()
    {
        var ids = FlashcardsKeybindManifest.Definitions.Select(definition => definition.ActionId).ToList();

        Assert.Equal(ids.Count, ids.Distinct(StringComparer.Ordinal).Count());
        foreach (var definition in FlashcardsKeybindManifest.Definitions)
        {
            Assert.StartsWith(definition.Namespace + ".", definition.ActionId, StringComparison.Ordinal);
            Assert.NotEmpty(definition.Bindings);
        }
    }

    [Fact]
    public void OcclusionEditorActions_CoverTheEditorsWholeKeyTable()
    {
        var actions = FlashcardsKeybindManifest.Definitions
            .Where(definition => definition.Namespace == FlashcardsKeybindManifest.OcclusionNamespace)
            .Select(definition => definition.ActionId.Split('.')[1])
            .ToHashSet(StringComparer.Ordinal);

        string[] expected =
        [
            "tool-select", "tool-pan", "tool-rect", "tool-ellipse", "tool-polygon", "finish-polygon", "cancel",
            "previous-mask", "next-mask", "nudge-left", "nudge-right", "nudge-up", "nudge-down",
            "nudge-left-big", "nudge-right-big", "nudge-up-big", "nudge-down-big", "move-earlier", "move-later",
            "rename", "group", "ungroup", "duplicate", "select-all", "delete", "undo", "redo",
            "zoom-in", "zoom-out", "zoom-fit", "toggle-masks",
        ];
        Assert.True(actions.SetEquals(expected), "the occlusion namespace drifted from the editor's actions");
    }

    [Theory]
    [InlineData("en")]
    [InlineData("de")]
    [InlineData("es")]
    [InlineData("ja")]
    [InlineData("nb")]
    public void EveryActionAndNamespaceHasALabel(string language)
    {
        var labels = KeybindLabels(language);
        var missing = new List<string>();

        foreach (var definition in FlashcardsKeybindManifest.Definitions)
        {
            if (!labels.TryGetProperty(definition.ActionId, out _)) missing.Add(definition.ActionId);
            if (!labels.TryGetProperty($"category.{definition.Namespace}", out _)) missing.Add($"category.{definition.Namespace}");
            if (!labels.TryGetProperty($"module.{definition.Namespace}", out _)) missing.Add($"module.{definition.Namespace}");
        }

        Assert.True(missing.Count == 0, $"{language} has no label for: {string.Join(", ", missing.Distinct())}");
    }
}
