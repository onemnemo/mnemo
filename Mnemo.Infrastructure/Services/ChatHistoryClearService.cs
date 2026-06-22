using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

public sealed class ChatHistoryClearService : IChatHistoryClearService
{
    private readonly IChatModuleHistoryService _chatHistoryService;
    private readonly IConversationMemoryStore _memoryStore;
    private readonly ILoggerService _logger;

    public ChatHistoryClearService(
        IChatModuleHistoryService chatHistoryService,
        IConversationMemoryStore memoryStore,
        ILoggerService logger)
    {
        _chatHistoryService = chatHistoryService;
        _memoryStore = memoryStore;
        _logger = logger;
    }

    public event EventHandler? Cleared;

    public async Task<Result> ClearAllAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            _memoryStore.EvictAll();

            var empty = new ChatModuleHistoryDocument { Version = 1, Conversations = new() };
            var save = await _chatHistoryService.SaveAsync(empty, cancellationToken).ConfigureAwait(false);
            if (!save.IsSuccess)
                return save;

            Cleared?.Invoke(this, EventArgs.Empty);
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("ChatHistoryClear", "Clear all failed", ex);
            return Result.Failure(ex.Message, ex);
        }
    }
}
