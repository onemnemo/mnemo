using System.Runtime.CompilerServices;
using System.Text;

namespace Mnemo.Host.Tests.I18n;

/// <summary>
/// Holds the served bundle to a recorded fingerprint, so moving where translations are
/// registered from can be shown to have moved nothing else. The recording covers all five
/// cultures down to the value of every string; a relocation that keeps the bundle intact
/// leaves it untouched, and anything else names the culture and the namespace that shifted.
/// Set MNEMO_I18N_SNAPSHOT_UPDATE to 1 to rewrite the recording instead of checking it.
/// </summary>
public sealed class TranslationBundleSnapshotTests
{
    private const string UpdateVariable = "MNEMO_I18N_SNAPSHOT_UPDATE";
    private const string RecordingName = "TranslationBundleSnapshot.baseline.txt";

    [Fact]
    public async Task TheServedBundleMatchesItsRecording()
    {
        var serving = await TranslationBundleFingerprint.RenderAsync(
            ServedTranslationBundle.FromHostComposition(), ServedTranslationBundle.Cultures);
        var path = RecordingPath();

        if (Environment.GetEnvironmentVariable(UpdateVariable) == "1")
        {
            // Written in the platform's own line endings, so rerecording an unchanged bundle
            // reproduces the file a checkout put there rather than reporting it modified.
            await File.WriteAllTextAsync(
                path, serving.Replace("\n", Environment.NewLine), new UTF8Encoding(false));
            return;
        }

        Assert.True(
            File.Exists(path),
            $"No recorded fingerprint at {path}. Set {UpdateVariable} to 1 and rerun to record one.");

        var recorded = Normalize(await File.ReadAllTextAsync(path));
        if (string.Equals(recorded, serving, StringComparison.Ordinal))
            return;

        Assert.Fail(Describe(recorded, serving, path));
    }

    /// <summary>Reads line endings out of the comparison; a checkout can supply either.</summary>
    private static string Normalize(string text) => text.Replace("\r\n", "\n");

    private static string RecordingPath([CallerFilePath] string testFile = "")
        => Path.Combine(Path.GetDirectoryName(testFile) ?? ".", RecordingName);

    private static string Describe(string recorded, string serving, string path)
    {
        var was = recorded.Split('\n');
        var now = serving.Split('\n');
        var report = new StringBuilder();
        report.AppendLine("The served translation bundle no longer matches its recording.");

        var shown = 0;
        for (var line = 0; line < Math.Max(was.Length, now.Length) && shown < 12; line++)
        {
            var before = line < was.Length ? was[line] : "(end of recording)";
            var after = line < now.Length ? now[line] : "(end of bundle)";
            if (string.Equals(before, after, StringComparison.Ordinal))
                continue;
            report.AppendLine($"  line {line + 1}: recorded '{before}', serving '{after}'");
            shown++;
        }

        report.AppendLine($"Recording lives at {path}; diff it for the whole picture.");
        report.AppendLine($"If the change is wanted, set {UpdateVariable} to 1, rerun, and commit the file.");
        return report.ToString();
    }
}
