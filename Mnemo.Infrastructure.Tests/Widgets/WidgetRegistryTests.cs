using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Services.Widgets;

namespace Mnemo.Infrastructure.Tests.Widgets;

public class WidgetRegistryTests
{
    [Fact]
    public void Register_ThenResolve_ReturnsDescriptor()
    {
        var registry = new WidgetRegistry();
        var descriptor = TestWidgetDescriptor.Create("mnemo.test", new WidgetSize(2, 1));

        registry.Register(descriptor);

        Assert.Same(descriptor, registry.GetDescriptor("mnemo.test"));
    }

    [Fact]
    public void GetDescriptor_UnknownId_ReturnsNull()
    {
        var registry = new WidgetRegistry();

        Assert.Null(registry.GetDescriptor("mnemo.unknown"));
        Assert.Null(registry.GetDescriptor(""));
    }

    [Fact]
    public void AvailableDescriptors_PreservesRegistrationOrder()
    {
        var registry = new WidgetRegistry();
        var first = TestWidgetDescriptor.Create("mnemo.first", new WidgetSize(1, 1));
        var second = TestWidgetDescriptor.Create("mnemo.second", new WidgetSize(1, 1));

        registry.Register(first);
        registry.Register(second);

        Assert.Equal(new[] { first, second }, registry.AvailableDescriptors);
    }

    [Fact]
    public void Register_DuplicateId_Throws()
    {
        var registry = new WidgetRegistry();
        registry.Register(TestWidgetDescriptor.Create("mnemo.dup", new WidgetSize(1, 1)));

        Assert.Throws<InvalidOperationException>(
            () => registry.Register(TestWidgetDescriptor.Create("mnemo.dup", new WidgetSize(2, 1))));
    }

    [Fact]
    public void Register_NullOrEmptyId_Throws()
    {
        var registry = new WidgetRegistry();

        Assert.Throws<ArgumentNullException>(() => registry.Register(null!));
        Assert.Throws<ArgumentException>(
            () => registry.Register(TestWidgetDescriptor.Create("", new WidgetSize(1, 1))));
    }
}
