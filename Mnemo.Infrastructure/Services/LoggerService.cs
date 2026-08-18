using System;
using System.IO;
using System.Text;
using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services;

public class LoggerService : ILoggerService
{
    /// <summary>How long a log file is kept before a later startup deletes it.</summary>
    private const int RetentionDays = 14;

    /// <summary>The size one file may reach before it is moved aside.</summary>
    private const long MaxFileBytes = 16L * 1024 * 1024;

    private readonly string _logDirectory;
    private readonly string _logFilePath;
    private readonly object _lock = new();

    /// <summary>Tracked rather than measured, so an append does not stat the file each time.</summary>
    private long _fileBytes;

    public LoggerService()
    {
        _logDirectory = MnemoAppPaths.GetLogsDirectory();
        Directory.CreateDirectory(_logDirectory);
        _logFilePath = Path.Combine(_logDirectory, $"log_{DateTime.Now:yyyyMMdd}.txt");
        _fileBytes = LengthOf(_logFilePath);
        DeleteExpired();
    }

    public void Log(LogLevel level, string category, string message, Exception? exception = null)
    {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        var logMessage = $"[{timestamp}] [{level}] [{category}] {message}";
        
        if (exception != null)
        {
            logMessage += $"{Environment.NewLine}Exception: {exception}";
        }

        // Console sink: omit Debug so subprocess/verbose logs stay in the file without flooding the console.
        if (level != LogLevel.Debug)
            Console.WriteLine(logMessage);
        
        // File Sink
        lock (_lock)
        {
            try
            {
                RollIfOversized();
                var line = logMessage + Environment.NewLine;
                File.AppendAllText(_logFilePath, line);
                _fileBytes += Encoding.UTF8.GetByteCount(line);
            }
            catch (Exception ex)
            {
                // If file logging fails, at least show it on console
                Console.WriteLine($"[FATAL] Failed to write to log file: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Moves the current file aside once it is large enough.
    /// </summary>
    /// <remarks>
    /// A single day's file is otherwise unbounded, and the case that fills a disk is not
    /// ordinary use but a fault that logs from inside a retry or a frame loop.
    /// </remarks>
    private void RollIfOversized()
    {
        if (_fileBytes < MaxFileBytes)
            return;

        for (var index = 1; index < 1000; index++)
        {
            var candidate = Path.ChangeExtension(_logFilePath, $"{index}.txt");
            if (File.Exists(candidate))
                continue;

            File.Move(_logFilePath, candidate);
            _fileBytes = 0;
            return;
        }

        // A thousand rolled files in one day means something is badly wrong, and starting
        // the file again still beats letting it grow without end.
        File.WriteAllText(_logFilePath, string.Empty);
        _fileBytes = 0;
    }

    /// <summary>
    /// Drops log files past the retention window.
    /// </summary>
    /// <remarks>
    /// At startup rather than on a timer: the directory grows by about a file a day, and an
    /// app left running for two weeks is not worth a background timer to catch.
    /// </remarks>
    private void DeleteExpired()
    {
        try
        {
            var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);

            foreach (var path in Directory.EnumerateFiles(_logDirectory, "log_*.txt"))
            {
                if (string.Equals(path, _logFilePath, StringComparison.OrdinalIgnoreCase))
                    continue;

                // By write time rather than by the date in the name, so rolled files are
                // covered too without a parser that has to understand both shapes.
                if (File.GetLastWriteTimeUtc(path) < cutoff)
                    File.Delete(path);
            }
        }
        catch (Exception ex)
        {
            // Housekeeping, and never worth failing a startup over.
            Console.WriteLine($"[WARN] Failed to clean up old log files: {ex.Message}");
        }
    }

    private static long LengthOf(string path)
    {
        try
        {
            var info = new FileInfo(path);
            return info.Exists ? info.Length : 0;
        }
        catch
        {
            return 0;
        }
    }
}

