using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Mnemo.Core.Services;
using Mnemo.Host.Startup;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Records activity for sessions remaining at shutdown. Uses an awaited stop operation because
/// stopping-token callbacks cannot await writes.
/// </summary>
internal sealed class StudySessionFlush : IHostedService
{
    private readonly StudySessionRegistry _registry;
    private readonly IStatisticsManager _statistics;
    private readonly IStudyDayService _studyDay;
    private readonly ILoggerService _logger;

    public StudySessionFlush(
        StudySessionRegistry registry,
        IStatisticsManager statistics,
        IStudyDayService studyDay,
        ILoggerService logger)
    {
        _registry = registry;
        _statistics = statistics;
        _studyDay = studyDay;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            foreach (var entry in _registry.TakeAll())
            {
                // Use the last request time so abandoned sessions do not count idle time as study.
                await StudySessionEndpoints
                    .EndEntryAsync(entry, entry.LastTouched, _statistics, _studyDay, _logger, cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Respect the host deadline when a session gate remains blocked; remaining sessions
            // are not recorded.
            _logger.Warning(CrashLog.Category,
                "The host stopped before every open study session had been recorded.");
        }
    }
}
