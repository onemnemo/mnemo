using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap.Style;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// The style cascade: element overrides → template root/depth/branch rules → theme defaults, plus
/// the shipped built-in templates. The resolver is a pure function, so these assert precedence and
/// token selection rather than rendered pixels.
/// </summary>
public sealed class MindmapStyleResolverTests
{
    private readonly IMindmapStyleResolver _resolver = new MindmapStyleResolver();

    private static IReadOnlyList<StyleTemplate> Chain(params StyleTemplate[] templates) => templates;

    [Fact]
    public void Resolve_EmptyChain_FallsBackToThemeDefaults()
    {
        var style = _resolver.Resolve(null, StyleContext.Root, Chain());

        Assert.Equal(MindmapStyleTokens.Surface, style.Fill);
        Assert.Equal(MindmapStyleTokens.Stroke, style.Stroke);
        Assert.Equal(MindmapStyleTokens.TextPrimary, style.TextColor);
        Assert.Equal(FontScale.M, style.FontScale);
        Assert.Equal(NodeShape.Card, style.NodeShape);
        Assert.Null(style.Icon);
        Assert.Null(style.BranchColor);
    }

    [Fact]
    public void Resolve_ElementOverride_BeatsTemplate()
    {
        var own = new ElementStyle { Fill = MindmapStyleTokens.Palette(3), NodeShape = NodeShape.Pill };

        var style = _resolver.Resolve(own, StyleContext.Root, Chain(MindmapBuiltInTemplates.DawnClassic));

        Assert.Equal(MindmapStyleTokens.Palette(3), style.Fill);
        Assert.Equal(NodeShape.Pill, style.NodeShape);
        // Members the override left null still come from the template's root rule.
        Assert.Equal(MindmapStyleTokens.OnAccent, style.TextColor);
    }

    [Fact]
    public void Resolve_Root_UsesTemplateRootStyle()
    {
        var style = _resolver.Resolve(null, StyleContext.Root, Chain(MindmapBuiltInTemplates.DawnClassic));

        Assert.Equal(MindmapStyleTokens.Accent, style.Fill);
        Assert.Equal(MindmapStyleTokens.OnAccent, style.TextColor);
        Assert.Equal(FontScale.L, style.FontScale);
    }

    [Fact]
    public void Resolve_DepthRules_ApplyByBand()
    {
        var template = MindmapBuiltInTemplates.DawnClassic;

        var depth1 = _resolver.Resolve(null, new StyleContext(1, 0, false), Chain(template));
        var depth3 = _resolver.Resolve(null, new StyleContext(3, 0, false), Chain(template));

        Assert.Equal(NodeShape.Card, depth1.NodeShape);
        Assert.Equal(FontScale.M, depth1.FontScale);
        Assert.Equal(NodeShape.Plain, depth3.NodeShape);
        Assert.Equal(FontScale.S, depth3.FontScale);
    }

    [Fact]
    public void Resolve_FirstMatchingDepthRule_Wins()
    {
        var template = new StyleTemplate
        {
            Id = "t",
            Name = "T",
            DepthRules = new[]
            {
                new DepthRule { MinDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Pill } },
                new DepthRule { MinDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Outline } },
            },
        };

        var style = _resolver.Resolve(null, new StyleContext(1, 0, false), Chain(template));

        Assert.Equal(NodeShape.Pill, style.NodeShape);
    }

    [Fact]
    public void Resolve_ByBranch_AssignsPaletteStrokePerBranch()
    {
        var template = MindmapBuiltInTemplates.RainbowBranches;

        var branch0 = _resolver.Resolve(null, new StyleContext(1, 0, false), Chain(template));
        var branch1 = _resolver.Resolve(null, new StyleContext(2, 1, false), Chain(template));

        Assert.Equal(MindmapStyleTokens.Palette(1), branch0.Stroke);
        Assert.Equal(MindmapStyleTokens.Palette(1), branch0.BranchColor);
        Assert.Equal(MindmapStyleTokens.Palette(2), branch1.Stroke);
        Assert.Equal(MindmapStyleTokens.Palette(2), branch1.BranchColor);
    }

    [Fact]
    public void Resolve_ByBranch_WrapsPaletteAfterEight()
    {
        var style = _resolver.Resolve(null, new StyleContext(1, 8, false), Chain(MindmapBuiltInTemplates.RainbowBranches));

        Assert.Equal(MindmapStyleTokens.Palette(1), style.BranchColor);
    }

    [Fact]
    public void Resolve_ExplicitStroke_BeatsBranchColorButStillExposesIt()
    {
        var template = new StyleTemplate
        {
            Id = "t",
            Name = "T",
            BranchColors = BranchColorMode.ByBranch,
            DepthRules = new[]
            {
                new DepthRule { MinDepth = 1, Style = new ElementStyle { Stroke = MindmapStyleTokens.Accent } },
            },
        };

        var style = _resolver.Resolve(null, new StyleContext(1, 2, false), Chain(template));

        Assert.Equal(MindmapStyleTokens.Accent, style.Stroke);
        Assert.Equal(MindmapStyleTokens.Palette(3), style.BranchColor);
    }

    [Fact]
    public void Resolve_FreeElement_SkipsTemplateRulesAndBranchColor()
    {
        var own = new ElementStyle { Fill = MindmapStyleTokens.SurfaceAlt };

        var style = _resolver.Resolve(own, StyleContext.Free, Chain(MindmapBuiltInTemplates.RainbowBranches));

        Assert.Equal(MindmapStyleTokens.SurfaceAlt, style.Fill);
        // No root rule, no depth rule, no branch color for a free element.
        Assert.Equal(MindmapStyleTokens.Stroke, style.Stroke);
        Assert.Equal(NodeShape.Card, style.NodeShape);
        Assert.Null(style.BranchColor);
    }

    [Fact]
    public void Resolve_LowerTemplate_FillsGapsLeftByHigherTemplate()
    {
        var cluster = new StyleTemplate { Id = "c", Name = "C" }; // sets nothing
        var document = MindmapBuiltInTemplates.DawnClassic;

        var style = _resolver.Resolve(null, StyleContext.Root, Chain(cluster, document));

        Assert.Equal(MindmapStyleTokens.Accent, style.Fill);
        Assert.Equal(MindmapStyleTokens.OnAccent, style.TextColor);
    }

    [Fact]
    public void Resolve_HigherTemplateBranchColor_BeatsLowerTemplateStroke()
    {
        var cluster = MindmapBuiltInTemplates.RainbowBranches; // ByBranch, no explicit depth-1 stroke
        var document = new StyleTemplate
        {
            Id = "d",
            Name = "D",
            DepthRules = new[]
            {
                new DepthRule { MinDepth = 1, Style = new ElementStyle { Stroke = MindmapStyleTokens.Stroke } },
            },
        };

        var style = _resolver.Resolve(null, new StyleContext(1, 0, false), Chain(cluster, document));

        Assert.Equal(MindmapStyleTokens.Palette(1), style.Stroke);
    }

    [Fact]
    public void BuiltIns_ShipSixTemplatesWithDawnClassicDefault()
    {
        Assert.Equal(6, MindmapBuiltInTemplates.All.Count);
        Assert.Equal(MindmapBuiltInTemplates.DefaultId, MindmapBuiltInTemplates.Default.Id);
        Assert.Same(MindmapBuiltInTemplates.DawnClassic, MindmapBuiltInTemplates.ById("dawn-classic"));
        Assert.Null(MindmapBuiltInTemplates.ById("no-such-template"));
    }
}
