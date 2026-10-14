using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Tests;

internal static class TestImages
{
    public static SharedImageStore Store(string? directory = null) => new(new ImageFileLocks(), new SilentLogger(), directory);

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
