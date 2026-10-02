using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Startup;

/// <summary>
/// Turns a failed load of the PhotinoX native library into the system package a Linux user
/// has to install.
/// </summary>
/// <remarks>
/// The native library links its dependencies directly, so one missing package surfaces as
/// "Unable to load shared library 'PhotinoX.Native'", naming Mnemo's own file rather than
/// the one that is absent. The loader's message does carry the missing soname, which is
/// what this reads.
/// </remarks>
internal static class LinuxNativeDependencies
{
    private const string Namespace = "App";

    // Ubuntu 24.04 and Debian 13 renamed the GTK package in their 64-bit time transition, so it
    // gets both commands. Each command stands on its own line so it can be pasted as it is.
    private static readonly (string Soname, string Package, string? NewerPackage, string Description)[] Known =
    [
        ("libnotify.so.4", "libnotify4", null, "libnotify"),
        ("libwebkit2gtk-4.1.so.0", "libwebkit2gtk-4.1-0", null, "WebKitGTK 4.1"),
        ("libjavascriptcoregtk-4.1.so.0", "libjavascriptcoregtk-4.1-0", null, "JavaScriptCoreGTK 4.1"),
        ("libgtk-3.so.0", "libgtk-3-0", "libgtk-3-0t64", "GTK 3"),
        ("libgdk-3.so.0", "libgtk-3-0", "libgtk-3-0t64", "GTK 3"),
    ];

    /// <summary>The bundled English text, for a failure before the saved language has loaded.</summary>
    private static readonly Lazy<IReadOnlyDictionary<string, string>> English = new(LoadEnglish);

    /// <summary>
    /// The title shown above <see cref="DescribeMissingPackage"/>, in the language
    /// <paramref name="localization"/> has loaded, or English when it has none.
    /// </summary>
    public static string Title(ILocalizationService? localization = null) => Text(localization, "MissingPackageTitle");

    /// <summary>
    /// Returns a message naming the package to install when <paramref name="error"/>, or an
    /// exception it wraps, is a native library load failure for a known dependency; otherwise null.
    /// Names <paramref name="logsDirectory"/> as where the full details went, when there is one.
    /// Written in the language <paramref name="localization"/> has loaded, or English when the
    /// failure came before any language did. Commands and package names are never translated.
    /// </summary>
    public static string? DescribeMissingPackage(
        Exception error, string? logsDirectory = null, ILocalizationService? localization = null)
    {
        for (var current = error; current is not null; current = current.InnerException)
        {
            if (current is not DllNotFoundException)
                continue;

            foreach (var (soname, package, newerPackage, description) in Known)
            {
                if (!current.Message.Contains(soname, StringComparison.Ordinal))
                    continue;

                var nl = Environment.NewLine;
                var install = $"sudo apt install {package}";
                if (newerPackage is not null)
                    install += $"{nl}{Text(localization, "MissingPackageNewerRelease")}{nl}sudo apt install {newerPackage}";

                var message = Text(localization, "MissingPackageBody").Replace("{0}", description).Replace("{1}", soname)
                    + $"{nl}{nl}{Text(localization, "MissingPackageInstall")}{nl}{install}"
                    + $"{nl}{nl}{Text(localization, "MissingPackageOtherDistributions").Replace("{0}", description)}";
                return logsDirectory is null
                    ? message
                    : message + $"{nl}{nl}{Text(localization, "MissingPackageLogs")}{nl}{logsDirectory}";
            }
        }

        return null;
    }

    private static string Text(ILocalizationService? localization, string key)
    {
        // A service with no language loaded yet answers with the key itself.
        var loaded = localization?.T(key, Namespace);
        if (loaded is not null && loaded != key)
            return loaded;

        return English.Value.TryGetValue(key, out var english) ? english : key;
    }

    private static IReadOnlyDictionary<string, string> LoadEnglish()
    {
        try
        {
            var bundle = new EmbeddedBuiltInTranslationSource().GetTranslationsForCulture("en");
            return bundle.TryGetValue(Namespace, out var keys) ? keys : new Dictionary<string, string>();
        }
        catch (Exception ex)
        {
            // A fault reading the bundle must not replace the one being reported.
            CrashLog.Write("The English text for the missing package notice did not load.", ex);
            return new Dictionary<string, string>();
        }
    }
}
