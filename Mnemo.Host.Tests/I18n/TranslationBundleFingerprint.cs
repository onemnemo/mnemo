using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Mnemo.Host.Tests.I18n;

/// <summary>
/// A stable text rendering of the served bundle: one block per culture carrying a hash over
/// every namespace, key and value, then the key count of each namespace. Ordering is ordinal
/// throughout and nothing in it varies between runs, so two renderings of the same bundle
/// compare byte for byte, and a difference names the culture and the namespace that moved.
/// </summary>
internal static class TranslationBundleFingerprint
{
    /// <summary>Newline used in the rendering, so a checkout convention cannot change it.</summary>
    private const string Newline = "\n";

    /// <summary>Renders every culture from one bundle, the way a running host serves them.</summary>
    internal static async Task<string> RenderAsync(ServedTranslationBundle bundle, IReadOnlyList<string> cultures)
    {
        var text = new StringBuilder();
        text.Append("# Fingerprint of the translation bundle the host serves, one block per culture.").Append(Newline);
        text.Append("# Namespaces are ordinal sorted; the number after each is how many keys it serves.").Append(Newline);
        text.Append("# The hash covers every namespace, key and value, so a changed string moves it too.").Append(Newline);

        foreach (var culture in cultures)
        {
            var served = await bundle.LoadAsync(culture).ConfigureAwait(false);
            Append(text, culture, served);
        }

        return text.ToString();
    }

    /// <summary>
    /// A hash over the whole bundle. Lengths are written before the text they measure, so no
    /// namespace, key or value can be rearranged into another one that hashes the same.
    /// </summary>
    internal static string Hash(IReadOnlyDictionary<string, Dictionary<string, string>> served)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var ns in Sorted(served.Keys))
        {
            Feed(hash, ns);
            var entries = served[ns];
            foreach (var key in Sorted(entries.Keys))
            {
                Feed(hash, key);
                Feed(hash, entries[key]);
            }
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private static void Append(
        StringBuilder text, string culture, IReadOnlyDictionary<string, Dictionary<string, string>> served)
    {
        var keys = served.Values.Sum(entries => entries.Count);
        text.Append(Newline);
        text.Append("culture ").Append(culture).Append(Newline);
        text.Append("sha256 ").Append(Hash(served)).Append(Newline);
        text.Append("namespaces ").Append(served.Count).Append(Newline);
        text.Append("keys ").Append(keys).Append(Newline);
        foreach (var ns in Sorted(served.Keys))
            text.Append("  ").Append(ns).Append(' ').Append(served[ns].Count).Append(Newline);
    }

    private static IEnumerable<string> Sorted(IEnumerable<string> values)
        => values.OrderBy(value => value, StringComparer.Ordinal);

    private static void Feed(IncrementalHash hash, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(length, bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }
}
