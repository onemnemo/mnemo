namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// Resolves a note's image reference to a path the Typst compiler can read. Typst rejects OS
/// drive-letter paths and only reads files under its <c>--root</c> sandbox, so the returned path
/// must be root-relative (e.g. <c>/assets/foo.png</c>) and the underlying file must already live
/// inside the per-export workdir. Implementations copy the resolved asset into that workdir.
/// </summary>
public interface INoteTypstAssetResolver
{
    /// <summary>
    /// Copies the asset named by <paramref name="reference"/> (an <c>attachment:{guid}:{name}</c>
    /// form, a managed id, or an absolute path) into the export workdir and returns its path
    /// relative to the Typst root, with a leading slash. Returns null when the asset cannot be
    /// resolved so the composer can fall back to alt text.
    /// </summary>
    string? ResolveImagePath(string reference);
}
