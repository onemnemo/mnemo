using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// An <see cref="IMnemoPayloadHandler"/> that can also say what importing its payload would mean,
/// without writing anything. Implemented alongside the handler interface rather than folded into
/// it, so a payload with nothing useful to compare simply does not offer the answer.
/// </summary>
public interface IMnemoPayloadInspector
{
    /// <summary>
    /// Compares the payload against what this collection already holds. Must not write.
    /// </summary>
    Task<MnemoPayloadEvidence> InspectAsync(
        MnemoPayloadImportContext context,
        CancellationToken cancellationToken = default);
}
