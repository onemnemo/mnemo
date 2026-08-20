using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Converts legacy embedded image tokens (<c>![alt](path){align=left|center|right}</c>, the exact
/// grammar the retired blob-era card text/preview regex parsers accepted) into
/// <see cref="FlashcardAttachment"/> records, so no downstream renderer needs to regex-parse card
/// text again.
/// </summary>
/// <remarks>
/// Per the migration spec: a token whose path resolves to an existing file on disk becomes an
/// attachment and is stripped from the text; a token whose path does not resolve is left inline
/// (never silently dropped) and reported via <see cref="FlashcardImageTokenConversionResult.Warnings"/>.
/// Each side is capped at <see cref="MaxAttachmentsPerSide"/> attachments, matching
/// <c>IFlashcardCardService.MaxAttachmentsPerSide</c>, so callers can pass the result straight into
/// card creation without tripping that cap; tokens beyond the cap are left inline and warned about too.
/// </remarks>
public static class FlashcardImageTokenConverter
{
    /// <summary>Max attachments this converter will create per side; mirrors <c>IFlashcardCardService.MaxAttachmentsPerSide</c>.</summary>
    public const int MaxAttachmentsPerSide = 3;

    /// <summary>
    /// Matches <c>![alt](path){align=left|center|right}</c>, the legacy embedded-image token grammar
    /// injected by <c>RichDocumentEditor</c> into blob-era card text.
    /// </summary>
    private static readonly Regex ImageTokenPattern = new(
        @"!\[(?<alt>[^\]]*)\]\((?<path>[^)]+)\)(?:\{align=(?<align>left|center|right)\})?",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    /// <summary>Collapses runs of 3+ blank lines left behind after a token is stripped down to at most one.</summary>
    private static readonly Regex ExcessBlankLinesPattern = new(@"(?:[ \t]*\r?\n){3,}", RegexOptions.Compiled);

    /// <summary>
    /// Converts embedded image tokens in <paramref name="front"/>/<paramref name="back"/> into
    /// attachment records, resolving each token's path against disk. Resolvable tokens are stripped
    /// from the returned text and converted to attachments (bounded by <see cref="MaxAttachmentsPerSide"/>
    /// per side); unresolvable or over-cap tokens are left inline untouched and reported in
    /// <see cref="FlashcardImageTokenConversionResult.Warnings"/>.
    /// </summary>
    public static FlashcardImageTokenConversionResult Convert(string? cardId, string? front, string? back)
    {
        var warnings = new List<FlashcardImageTokenWarning>();
        var attachments = new List<FlashcardAttachment>();

        var cleanFront = ConvertSide(cardId, front ?? string.Empty, FlashcardAttachment.FrontSide, attachments, warnings);
        var cleanBack = ConvertSide(cardId, back ?? string.Empty, FlashcardAttachment.BackSide, attachments, warnings);

        return new FlashcardImageTokenConversionResult(cleanFront, cleanBack, attachments, warnings);
    }

    private static string ConvertSide(
        string? cardId,
        string text,
        string side,
        List<FlashcardAttachment> attachments,
        List<FlashcardImageTokenWarning> warnings)
    {
        if (string.IsNullOrEmpty(text) || !ImageTokenPattern.IsMatch(text))
            return text;

        var convertedOnSide = 0;
        var result = ImageTokenPattern.Replace(text, match =>
        {
            var path = match.Groups["path"].Value.Trim();
            var alt = match.Groups["alt"].Value;

            if (convertedOnSide >= MaxAttachmentsPerSide)
            {
                warnings.Add(new FlashcardImageTokenWarning(
                    cardId, side, path,
                    $"Card '{cardId}' side '{side}' already has {MaxAttachmentsPerSide} attachments; leaving extra image token inline: '{path}'."));
                return match.Value; // leave inline, cap reached
            }

            FileInfo fileInfo;
            try
            {
                fileInfo = new FileInfo(path);
            }
            catch (Exception ex) when (ex is ArgumentException or PathTooLongException or NotSupportedException)
            {
                warnings.Add(new FlashcardImageTokenWarning(
                    cardId, side, path,
                    $"Card '{cardId}' side '{side}' has an unresolvable image path; leaving token inline: '{path}'."));
                return match.Value;
            }

            if (!fileInfo.Exists)
            {
                warnings.Add(new FlashcardImageTokenWarning(
                    cardId, side, path,
                    $"Card '{cardId}' side '{side}' references a missing image file; leaving token inline: '{path}'."));
                return match.Value;
            }

            convertedOnSide++;
            attachments.Add(new FlashcardAttachment(
                Id: Guid.NewGuid().ToString("N"),
                Side: side,
                FilePath: fileInfo.FullName,
                DisplayName: fileInfo.Name,
                SizeBytes: fileInfo.Length,
                Caption: string.IsNullOrWhiteSpace(alt) ? null : alt));

            return string.Empty; // strip the token
        });

        return CollapseBlankLines(result);
    }

    /// <summary>
    /// Collapses runs of blank lines left behind by token stripping down to a single blank line, and
    /// drops any blank lines stripping left at the very start/end of the field (common when a token
    /// occupied its own line).
    /// </summary>
    private static string CollapseBlankLines(string text)
    {
        var collapsed = ExcessBlankLinesPattern.Replace(text, "\n\n");
        var lines = collapsed.Split('\n');

        var start = 0;
        while (start < lines.Length && string.IsNullOrWhiteSpace(lines[start]))
            start++;
        var end = lines.Length - 1;
        while (end >= start && string.IsNullOrWhiteSpace(lines[end]))
            end--;

        return start > end ? string.Empty : string.Join('\n', lines[start..(end + 1)]);
    }
}

/// <summary>Result of converting one card's front/back text: clean text plus any attachments created.</summary>
public sealed record FlashcardImageTokenConversionResult(
    string CleanFront,
    string CleanBack,
    IReadOnlyList<FlashcardAttachment> Attachments,
    IReadOnlyList<FlashcardImageTokenWarning> Warnings);

/// <summary>A single unresolved/over-cap image token left inline, for the caller to log with its own context.</summary>
public sealed record FlashcardImageTokenWarning(string? CardId, string Side, string Path, string Message);
