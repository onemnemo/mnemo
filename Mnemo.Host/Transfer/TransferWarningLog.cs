using System.Text.RegularExpressions;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Transfer;

/// <summary>
/// Writes a transfer's full warning list to the app log, since the notification only shows
/// grouped summaries. One log entry per import, not per warning, so a large import with broken
/// media does not make thousands of locked appends inside one request.
/// </summary>
public static partial class TransferWarningLog
{
    /// <summary>
    /// A token rooted at a drive, UNC share, <c>~/</c> or <c>/</c>. Anchored to a token start so
    /// "PNG/JPEG" or "and/or" never match. Paths are cut to the file name because they carry the
    /// username.
    /// </summary>
    [GeneratedRegex(@"(?:^|(?<=\s))(?:[A-Za-z]:[\\/][^\s]*|\\\\[^\s\\]+\\[^\s]*|~/[^\s]*|/[^\s]+)")]
    private static partial Regex RootedPath();

    public static void Log(ILoggerService logger, string category, IReadOnlyList<TransferWarningDto> warnings)
    {
        if (warnings.Count == 0)
            return;

        var groups = warnings
            .GroupBy(warning => (warning.Key, Reason: ReasonOf(warning)))
            .Select(group =>
            {
                var names = group.Select(FormatIdentity).ToList();
                var reason = group.Key.Reason is { } text ? $": {text}" : string.Empty;
                return $"{group.Key.Key} x{names.Count}{reason} [{string.Join(", ", names)}]";
            });

        logger.Info(category, string.Join(Environment.NewLine, groups));
    }

    /// <summary>The warning's reported reason, redacted, or null when absent or blank.</summary>
    private static string? ReasonOf(TransferWarningDto warning)
    {
        if (!warning.Params.TryGetValue("error", out var error))
            return null;

        var trimmed = error.Trim();
        return trimmed.Length > 0 ? RedactPaths(trimmed) : null;
    }

    /// <summary>
    /// Every param but the reason, which the group already shows. Not redacted: a slash in a deck
    /// or note name is not a path.
    /// </summary>
    private static string FormatIdentity(TransferWarningDto warning)
    {
        var identity = string.Join(
            " ",
            warning.Params.Where(pair => pair.Key != "error").Select(pair => $"{pair.Key}={pair.Value}"));
        return identity.Length > 0 ? identity : warning.Key;
    }

    /// <summary>Every rooted path in <paramref name="text"/> cut down to its file name.</summary>
    internal static string RedactPaths(string text)
    {
        return RootedPath().Replace(text, match =>
        {
            var token = match.Value;
            var end = token.Length;
            while (end > 0 && ".,;:)]}\"'".IndexOf(token[end - 1]) >= 0)
                end--;

            var core = token[..end];
            var trailingPunctuation = token[end..];

            string fileName;
            try
            {
                fileName = Path.GetFileName(core);
            }
            catch (ArgumentException)
            {
                return token;
            }

            return fileName.Length > 0 ? fileName + trailingPunctuation : token;
        });
    }
}
