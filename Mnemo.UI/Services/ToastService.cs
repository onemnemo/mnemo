using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Services;

public sealed class ToastService : IToastService
{
    public const string EnableToastsSettingKey = "App.EnableToasts";
    public const int MaxVisibleToasts = 6;
    private const int MaxHistoryEntries = 200;

    private readonly ISettingsService _settingsService;
    private readonly IMainThreadDispatcher _mainThreadDispatcher;
    private readonly object _historyLock = new();
    private readonly List<NotificationHistoryEntry> _history = new();
    private readonly List<ToastItemViewModel> _timed = new();
    private readonly List<ToastItemViewModel> _sticky = new();

    public ObservableCollection<ToastItemViewModel> ActiveToasts { get; } = new();

    public event EventHandler? NotificationHistoryChanged;

    public ToastService(ISettingsService settingsService, IMainThreadDispatcher mainThreadDispatcher)
    {
        _settingsService = settingsService;
        _mainThreadDispatcher = mainThreadDispatcher;
    }

    public void SpawnToast(ToastType toastType, TimeSpan duration, string title, string description, ToastActionSpec? actions = null)
    {
        var id = Guid.NewGuid();
        var entry = new NotificationHistoryEntry
        {
            Id = id,
            ToastType = toastType,
            Title = title,
            Description = description,
            CreatedAt = DateTimeOffset.Now,
        };

        lock (_historyLock)
        {
            _history.Insert(0, entry);
            while (_history.Count > MaxHistoryEntries)
                _history.RemoveAt(_history.Count - 1);
        }

        RaiseHistoryChanged();

        _ = _mainThreadDispatcher.InvokeAsync(async () =>
        {
            var enabled = await _settingsService.GetAsync(EnableToastsSettingKey, true).ConfigureAwait(true);
            if (!enabled)
                return;

            var item = new ToastItemViewModel(id, toastType, title, description, duration, RemoveToast, actions);
            if (duration <= TimeSpan.Zero)
                _sticky.Add(item);
            else
                _timed.Add(item);

            EnforceCapacity();
            SyncActiveCollectionWithDesiredOrder();
        });
    }

    public IReadOnlyList<NotificationHistoryEntry> GetRecentNotifications(int maxCount)
    {
        lock (_historyLock)
            return _history.Take(Math.Max(0, maxCount)).ToList();
    }

    private void RemoveToast(Guid id)
    {
        _ = _mainThreadDispatcher.InvokeAsync(() =>
        {
            if (!TryRemoveFromBackingLists(id, out var vm) || vm is null)
                return Task.CompletedTask;

            ActiveToasts.Remove(vm);
            vm.Dispose();
            return Task.CompletedTask;
        });
    }

    private bool TryRemoveFromBackingLists(Guid id, out ToastItemViewModel? vm)
    {
        vm = null;
        var timed = _timed.FirstOrDefault(t => t.Id == id);
        if (timed != null)
        {
            _timed.Remove(timed);
            vm = timed;
            return true;
        }

        var sticky = _sticky.FirstOrDefault(t => t.Id == id);
        if (sticky != null)
        {
            _sticky.Remove(sticky);
            vm = sticky;
            return true;
        }

        return false;
    }

    private void EnforceCapacity()
    {
        while (_timed.Count + _sticky.Count > MaxVisibleToasts)
        {
            ToastItemViewModel? evict = null;
            if (_timed.Count > 0)
            {
                evict = _timed[0];
                _timed.RemoveAt(0);
            }
            else if (_sticky.Count > 0)
            {
                evict = _sticky[0];
                _sticky.RemoveAt(0);
            }
            else
                break;

            ActiveToasts.Remove(evict);
            evict.Dispose();
        }
    }

    /// <summary>
    /// Desired order top → bottom: newest timed … oldest timed, then oldest sticky … newest sticky (corner).
    /// Updates <see cref="ActiveToasts"/> with Remove/Move/Insert only; avoids Clear() so items do not flicker.
    /// </summary>
    private void SyncActiveCollectionWithDesiredOrder()
    {
        var desired = new List<ToastItemViewModel>(_timed.Count + _sticky.Count);
        for (var i = _timed.Count - 1; i >= 0; i--)
            desired.Add(_timed[i]);
        foreach (var s in _sticky)
            desired.Add(s);

        for (var i = ActiveToasts.Count - 1; i >= 0; i--)
        {
            if (!desired.Contains(ActiveToasts[i]))
                ActiveToasts.RemoveAt(i);
        }

        for (var i = 0; i < desired.Count; i++)
        {
            var vm = desired[i];
            var idx = ActiveToasts.IndexOf(vm);
            if (idx < 0)
                ActiveToasts.Insert(i, vm);
            else if (idx != i)
                ActiveToasts.Move(idx, i);
        }
    }

    private void RaiseHistoryChanged()
    {
        _ = _mainThreadDispatcher.InvokeAsync(() =>
        {
            NotificationHistoryChanged?.Invoke(this, EventArgs.Empty);
            return Task.CompletedTask;
        });
    }
}
