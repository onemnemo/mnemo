using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Host.Startup;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Tests.Startup;

public sealed class LinuxNativeDependenciesTests
{
    // The loader's text on a clean Ubuntu 24.04 without libnotify4.
    private const string MissingLibnotify =
        "Unable to load shared library 'PhotinoX.Native' or one of its dependencies. In order to help diagnose loading problems, "
        + "consider using a tool like strace. If you're using glibc, consider setting the LD_DEBUG environment variable: "
        + "libnotify.so.4: cannot open shared object file: No such file or directory";

    [Fact]
    public void NamesThePackageForAMissingLibnotify()
    {
        var message = LinuxNativeDependencies.DescribeMissingPackage(new DllNotFoundException(MissingLibnotify));

        Assert.NotNull(message);
        Assert.Contains("libnotify (libnotify.so.4) is not installed", message);
        Assert.Contains("sudo apt install libnotify4", message);
        Assert.DoesNotContain("PhotinoX", message);
    }

    [Fact]
    public void LooksThroughATypeInitializerThatWrapsTheLoadFailure()
    {
        var wrapped = new TypeInitializationException("Photino.NET.PhotinoWindow", new DllNotFoundException(MissingLibnotify));

        Assert.Contains("libnotify4", LinuxNativeDependencies.DescribeMissingPackage(wrapped));
    }

    [Theory]
    [InlineData("libwebkit2gtk-4.1.so.0", "libwebkit2gtk-4.1-0")]
    [InlineData("libjavascriptcoregtk-4.1.so.0", "libjavascriptcoregtk-4.1-0")]
    [InlineData("libgtk-3.so.0", "libgtk-3-0")]
    [InlineData("libgdk-3.so.0", "libgtk-3-0")]
    public void NamesThePackageForTheOtherWindowLibraries(string soname, string package)
    {
        var error = new DllNotFoundException($"Unable to load shared library 'PhotinoX.Native': {soname}: cannot open shared object file");

        Assert.Contains($"sudo apt install {package}", LinuxNativeDependencies.DescribeMissingPackage(error));
    }

    [Fact]
    public void NamesBothSpellingsOfTheGtkPackage()
    {
        var message = LinuxNativeDependencies.DescribeMissingPackage(new DllNotFoundException("libgdk-3.so.0: cannot open shared object file"));

        var lines = message!.Split(Environment.NewLine);
        Assert.Contains("sudo apt install libgtk-3-0", lines);
        Assert.Contains("sudo apt install libgtk-3-0t64", lines);
    }

    [Fact]
    public void SaysWhereTheFullDetailsWent()
    {
        var error = new DllNotFoundException(MissingLibnotify);

        Assert.EndsWith($"The full details were written to:{Environment.NewLine}/home/a/.local/share/Mnemo/logs",
            LinuxNativeDependencies.DescribeMissingPackage(error, "/home/a/.local/share/Mnemo/logs"));
        Assert.DoesNotContain("full details", LinuxNativeDependencies.DescribeMissingPackage(error));
    }

    [Fact]
    public void LeavesAnyOtherFailureToTheGeneralReport()
    {
        Assert.Null(LinuxNativeDependencies.DescribeMissingPackage(new DllNotFoundException("Unable to load shared library 'e_sqlite3'")));
        Assert.Null(LinuxNativeDependencies.DescribeMissingPackage(new InvalidOperationException("libnotify.so.4")));
    }

    [Fact]
    public void WritesNoDashesAPersonWouldRead()
    {
        var message = LinuxNativeDependencies.DescribeMissingPackage(new DllNotFoundException(MissingLibnotify))!;

        Assert.DoesNotContain('\u2013', message);
        Assert.DoesNotContain('\u2014', message);
        Assert.DoesNotContain('\u2013', LinuxNativeDependencies.Title());
        Assert.DoesNotContain('\u2014', LinuxNativeDependencies.Title());
    }

    [Theory]
    [InlineData("de", "Mnemo ben\u00f6tigt ein Systempaket", "libnotify (libnotify.so.4) nicht installiert")]
    [InlineData("es", "Mnemo necesita un paquete del sistema", "libnotify (libnotify.so.4) no est\u00e1 instalado")]
    [InlineData("ja", "Mnemo\u306b\u306f\u30b7\u30b9\u30c6\u30e0\u30d1\u30c3\u30b1\u30fc\u30b8\u304c\u5fc5\u8981\u3067\u3059", "libnotify\uff08libnotify.so.4\uff09\u304c\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3055\u308c\u3066\u3044\u306a\u3044")]
    [InlineData("nb", "Mnemo trenger en systempakke", "libnotify (libnotify.so.4) ikke er installert")]
    public async Task SpeaksTheSavedLanguageOnceItHasLoaded(string language, string title, string missing)
    {
        var localization = new LocalizationService([new EmbeddedBuiltInTranslationSource()], new SilentLogger());
        Assert.True(await localization.SetLanguageAsync(language));

        var message = LinuxNativeDependencies.DescribeMissingPackage(
            new DllNotFoundException(MissingLibnotify), "/home/a/.local/share/Mnemo/logs", localization)!;

        Assert.Equal(title, LinuxNativeDependencies.Title(localization));
        Assert.Contains(missing, message);
        Assert.Contains("sudo apt install libnotify4", message.Split(Environment.NewLine));
        Assert.DoesNotContain("not installed", message);
        Assert.DoesNotContain("full details", message);
        Assert.EndsWith("/home/a/.local/share/Mnemo/logs", message);
    }

    [Fact]
    public async Task KeepsBothGtkCommandsWholeInAnotherLanguage()
    {
        var localization = new LocalizationService([new EmbeddedBuiltInTranslationSource()], new SilentLogger());
        await localization.SetLanguageAsync("de");

        var lines = LinuxNativeDependencies
            .DescribeMissingPackage(new DllNotFoundException("libgtk-3.so.0: cannot open shared object file"), null, localization)!
            .Split(Environment.NewLine);

        Assert.Contains("sudo apt install libgtk-3-0", lines);
        Assert.Contains("Unter Ubuntu 24.04 oder Debian 13:", lines);
        Assert.Contains("sudo apt install libgtk-3-0t64", lines);
    }

    [Fact]
    public void SpeaksEnglishWhenTheFailureCameBeforeAnyLanguageLoaded()
    {
        var unloaded = new LocalizationService([new EmbeddedBuiltInTranslationSource()], new SilentLogger());

        Assert.Equal("Mnemo needs a system package", LinuxNativeDependencies.Title(unloaded));
        Assert.Contains("libnotify (libnotify.so.4) is not installed",
            LinuxNativeDependencies.DescribeMissingPackage(new DllNotFoundException(MissingLibnotify), null, unloaded));
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
