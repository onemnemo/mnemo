using System;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// What every step of the trash protocol needs. Passed around so each step stays a small file
/// with one responsibility instead of a method on one large service.
/// </summary>
/// <param name="Store">The ledger.</param>
/// <param name="Sources">The registered sources.</param>
/// <param name="Logger">Where protocol failures are reported.</param>
/// <param name="Time">The clock deletion and expiry are stamped from.</param>
/// <param name="Maintenance">Where an uncertain outcome asks for a background pass.</param>
internal sealed record TrashContext(
    ITrashStore Store,
    TrashSourceRegistry Sources,
    ILoggerService Logger,
    TimeProvider Time,
    ITrashMaintenance Maintenance);
