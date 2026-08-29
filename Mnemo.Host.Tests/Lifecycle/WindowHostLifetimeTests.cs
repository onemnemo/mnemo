using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Mnemo.Host.Lifecycle;
using Xunit;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// Checks that the default lifetime is removed so signals cannot stop the save channel before the
/// window closes.
/// </summary>
public sealed class WindowHostLifetimeTests
{
    [Fact]
    public async Task InstallLeavesTheInertLifetimeAsTheOneTheHostResolves()
    {
        await using var untouched = WebApplication.CreateBuilder().Build();
        // Verify a default registration exists before testing its replacement.
        Assert.IsNotType<WindowHostLifetime>(untouched.Services.GetRequiredService<IHostLifetime>());

        var builder = WebApplication.CreateBuilder();
        WindowHostLifetime.Install(builder.Services);
        await using var app = builder.Build();

        Assert.IsType<WindowHostLifetime>(app.Services.GetRequiredService<IHostLifetime>());
    }

    [Fact]
    public async Task TheInertLifetimeNeitherHoldsStartupNorUnwindsAnything()
    {
        var lifetime = new WindowHostLifetime();

        await lifetime.WaitForStartAsync(CancellationToken.None);
        await lifetime.StopAsync(CancellationToken.None);

        Assert.True(lifetime.WaitForStartAsync(CancellationToken.None).IsCompletedSuccessfully);
        Assert.True(lifetime.StopAsync(CancellationToken.None).IsCompletedSuccessfully);
    }
}
