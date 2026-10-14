using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Host.Composition;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Tests.Assets;

public sealed class ImageAssetCompositionTests
{
    [Fact]
    public async Task EveryImageWriterSharesOneStore()
    {
        var modules = HostComposition.DiscoverModules(out var failures);
        Assert.Empty(failures);
        var services = new ServiceCollection();
        HostComposition.AddMnemoBackend(services, modules);
        await using var provider = services.BuildServiceProvider();

        var files = provider.GetRequiredService<SharedImageStore>();

        Assert.Same(files, provider.GetRequiredService<IImageAssetService>());
        Assert.NotNull(provider.GetRequiredService<StartupAssetSweep>());
        Assert.NotNull(provider.GetRequiredService<DuplicateImageFold>());
    }

    [Theory]
    [InlineData("PUT", "/api/notes/n1", true)]
    [InlineData("POST", "/api/mindmaps/m1/ops", true)]
    [InlineData("PUT", "/api/cards/c1", true)]
    [InlineData("POST", "/api/decks", true)]
    [InlineData("POST", "/api/deck-folders", true)]
    [InlineData("POST", "/api/facts", true)]
    [InlineData("POST", "/api/note-folders", true)]
    [InlineData("POST", "/api/chat/conversations/c1/turns", true)]
    [InlineData("POST", "/api/trash/e1/restore", true)]
    [InlineData("GET", "/api/notes/n1", false)]
    [InlineData("POST", "/api/app/shutdown-ready", false)]
    [InlineData("POST", "/api/app/client-info", false)]
    [InlineData("POST", "/api/proofing/check", false)]
    public void TheStartupGateHoldsEveryApiWriteButTheStartupRoutes(string method, string path, bool held)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;

        Assert.Equal(held, StartupAssetSweep.IsGated(context.Request));
    }
}
