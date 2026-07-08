using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Style;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Covers persistence of user style templates and the provider that merges them with the built-ins.
/// </summary>
public sealed class MindmapStyleTemplateStoreTests
{
    [Fact]
    public async Task GetStyleTemplates_Empty_OnFreshDatabase()
    {
        await using var h = new MindmapTestHarness();
        Assert.Empty(await h.Store.GetStyleTemplatesAsync());
    }

    [Fact]
    public async Task SaveAndGet_RoundTripsAllFields()
    {
        await using var h = new MindmapTestHarness();
        var template = Sample("mine", "My Look");

        await h.Store.SaveStyleTemplateAsync(template);
        var loaded = Assert.Single(await h.Store.GetStyleTemplatesAsync());

        Assert.Equal("mine", loaded.Id);
        Assert.Equal("My Look", loaded.Name);
        Assert.Equal(template.RootStyle, loaded.RootStyle);
        Assert.Equal(BranchColorMode.ByBranch, loaded.BranchColors);
        Assert.Equal(template.EdgeDefaults, loaded.EdgeDefaults);
        Assert.Equal(template.LayoutDefaults, loaded.LayoutDefaults);
        Assert.Equal(template.DepthRules.Count, loaded.DepthRules.Count);
        Assert.Equal(template.DepthRules[0], loaded.DepthRules[0]);
    }

    [Fact]
    public async Task Save_Twice_UpsertsByIdWithoutDuplicating()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveStyleTemplateAsync(Sample("mine", "First"));
        await h.Store.SaveStyleTemplateAsync(Sample("mine", "Renamed"));

        var loaded = Assert.Single(await h.Store.GetStyleTemplatesAsync());
        Assert.Equal("Renamed", loaded.Name);
    }

    [Fact]
    public async Task Delete_RemovesTemplate()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveStyleTemplateAsync(Sample("mine", "My Look"));

        await h.Store.DeleteStyleTemplateAsync("mine");

        Assert.Empty(await h.Store.GetStyleTemplatesAsync());
    }

    [Fact]
    public async Task Provider_BeforeRefresh_ExposesBuiltInsOnly()
    {
        await using var h = new MindmapTestHarness();
        var provider = new MindmapStyleTemplateProvider(h.Store);

        Assert.Empty(provider.UserTemplates);
        Assert.Equal(MindmapBuiltInTemplates.All.Count, provider.All.Count);
        Assert.NotNull(provider.ById(MindmapBuiltInTemplates.DefaultId));
    }

    [Fact]
    public async Task Provider_Refresh_MergesUserTemplatesOverBuiltIns()
    {
        await using var h = new MindmapTestHarness();
        await h.Store.SaveStyleTemplateAsync(Sample("mine", "My Look"));

        var provider = new MindmapStyleTemplateProvider(h.Store);
        await provider.RefreshAsync();

        Assert.Equal("My Look", Assert.Single(provider.UserTemplates).Name);
        Assert.Equal(MindmapBuiltInTemplates.All.Count + 1, provider.All.Count);
        Assert.NotNull(provider.ById("mine"));                          // user template resolves
        Assert.NotNull(provider.ById(MindmapBuiltInTemplates.DefaultId)); // built-in still resolves
    }

    [Fact]
    public async Task Provider_Save_PersistsAndSurfacesWithoutManualRefresh()
    {
        await using var h = new MindmapTestHarness();
        var provider = new MindmapStyleTemplateProvider(h.Store);

        await provider.SaveAsync(Sample("mine", "My Look"));

        Assert.NotNull(provider.ById("mine"));
        Assert.Single(await h.Store.GetStyleTemplatesAsync());
    }

    [Fact]
    public async Task Provider_Delete_RemovesUserTemplateButKeepsBuiltIns()
    {
        await using var h = new MindmapTestHarness();
        var provider = new MindmapStyleTemplateProvider(h.Store);
        await provider.SaveAsync(Sample("mine", "My Look"));

        await provider.DeleteAsync("mine");

        Assert.Null(provider.ById("mine"));
        Assert.Empty(provider.UserTemplates);
        Assert.NotNull(provider.ById(MindmapBuiltInTemplates.DefaultId));
    }

    private static StyleTemplate Sample(string id, string name) => new()
    {
        Id = id,
        Name = name,
        RootStyle = new ElementStyle
        {
            Fill = MindmapStyleTokens.Accent,
            TextColor = MindmapStyleTokens.OnAccent,
            NodeShape = NodeShape.Card,
            FontScale = FontScale.L,
        },
        DepthRules = new[]
        {
            new DepthRule { MinDepth = 1, MaxDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Pill, FontScale = FontScale.M } },
        },
        BranchColors = BranchColorMode.ByBranch,
        EdgeDefaults = new EdgeStyle { Line = LineStyle.Dashed, Routing = EdgeRouting.Curve },
        LayoutDefaults = new LayoutOptions { NodeSpacing = 28, RankSpacing = 110 },
    };
}
