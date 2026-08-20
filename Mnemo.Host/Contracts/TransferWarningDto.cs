using Mnemo.Core.Models;

namespace Mnemo.Host.Contracts;

/// <summary>
/// Wire shape for <see cref="TransferWarning"/>: a translation key plus the values a locale needs
/// to render it. Mirrored in <c>mnemo-web/src/api/types.ts</c>.
/// </summary>
public sealed record TransferWarningDto(string Key, IReadOnlyDictionary<string, string> Params)
{
    private static readonly IReadOnlyDictionary<string, string> EmptyParams =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public static TransferWarningDto FromModel(TransferWarning model) => new(model.Key, model.Params);

    /// <summary>
    /// What an upload endpoint reports when the coordinator could not even preview the file. Shared
    /// by the three transfer endpoints so the key and wording stay identical across them.
    /// </summary>
    public static TransferWarningDto UploadPreviewFailed(string? errorMessage) =>
        errorMessage is { } message
            ? new TransferWarningDto("UploadPreviewFailed", new Dictionary<string, string>(StringComparer.Ordinal) { ["error"] = message })
            : new TransferWarningDto("UploadPreviewUnavailable", EmptyParams);

    /// <summary>Same key, with <paramref name="fileName"/> folded into the params so a batch result
    /// can say which upload a warning came from without baking the name into English prose.</summary>
    public TransferWarningDto WithFileName(string fileName)
    {
        var merged = new Dictionary<string, string>(Params, StringComparer.Ordinal)
        {
            ["fileName"] = fileName
        };
        return this with { Params = merged };
    }
}
