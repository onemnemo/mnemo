using Mnemo.Infrastructure.Services;

namespace Mnemo.Infrastructure.Tests;

internal static class TestImages
{
    public static SharedImageStore Store(string? directory = null) => new(new ImageFileLocks(), new TestLogger(), directory);
}
