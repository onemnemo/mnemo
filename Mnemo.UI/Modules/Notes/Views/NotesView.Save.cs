using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.History;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.BlockEditor;
using Mnemo.UI.Modules.Notes.Services;
using Mnemo.UI.Modules.Notes.ViewModels;
using Mnemo.UI.Services;

namespace Mnemo.UI.Modules.Notes.Views;

public partial class NotesView
{
    private bool _editorOpenNoteWired;
    private bool _blocksChangedSubscribed;
    private DispatcherTimer? _saveDebounceTimer;
    private bool _saveTimerRunning;
    private Note? _pendingSaveNote;
    private (string NoteId, long Fingerprint)? _lastSavedFingerprint;
    private BlockEditor? _cachedBlockEditor;
    private Note? _previousSelectedNote;

    private BlockEditor? GetBlockEditor()
    {
        if (_cachedBlockEditor != null) return _cachedBlockEditor;
        _cachedBlockEditor = this.FindControl<BlockEditor>("NoteBlockEditor");
        return _cachedBlockEditor;
    }

    private void LoadBlocksForCurrentNote()
    {
        if (DataContext is not NotesViewModel vm)
            return;

        var editor = GetBlockEditor();
        if (editor == null)
            return;

        var perf = EditorPerfDiagnostics.Resolve();
        using var loadScope = EditorPerfDiagnostics.Measure(
            perf,
            "notes.loadBlocksForNote",
            vm.SelectedNote?.NoteId ?? "(none)");

        var sp = ((App)Application.Current!).Services;
        if (editor.History == null)
        {
            var historyManager = vm.EditorHistory;
            if (historyManager != null)
                editor.History = historyManager;
        }
        if (sp != null)
        {
            editor.NoteClipboardCodec ??= sp.GetService<INoteClipboardPayloadCodec>();
            editor.NoteClipboardService ??= sp.GetService<INoteClipboardPlatformService>();
            editor.ImageAssetService ??= sp.GetService<IImageAssetService>();
        }

        editor.HostNoteId = vm.SelectedNote?.NoteId;
        editor.NoteTitleResolver = id => vm.ResolveNoteTitleForPageBlock(id);
        editor.ChildPageCountResolver = id => vm.CountDirectChildPagesForNote(id);
        editor.CreateChildPageUnderNoteAsync = vm.CreateChildPageNoteUnderParentAsync;
        var loc = sp?.GetService<ILocalizationService>();
        editor.PageBlockMissingTitle = loc?.T("PageMissingTitle", "NotesEditor") ?? "Missing note";

        if (!_editorOpenNoteWired)
        {
            editor.OpenReferencedNote += OnBlockEditorOpenReferencedNote;
            _editorOpenNoteWired = true;
        }

        editor.FlushPendingNoteSaveAsync = FlushEditorToSelectedNoteAsync;
        var blocksForNote = vm.GetBlocksForCurrentNote();
        editor.LoadBlocks(blocksForNote);
        vm.UpdateWordCount(blocksForNote);

        if (!_blocksChangedSubscribed)
        {
            _blocksChangedSubscribed = true;
            editor.BlocksChanged += OnBlockEditorBlocksChanged;
        }

        var loadedNoteId = vm.SelectedNote?.NoteId;
        _lastSavedFingerprint = loadedNoteId != null
            ? (loadedNoteId, editor.ComputeContentFingerprint())
            : null;
    }

    private void OnBlockEditorBlocksChanged()
    {
        if (DataContext is not NotesViewModel vm || vm.SelectedNote == null)
            return;

        _pendingSaveNote = vm.SelectedNote;

        if (_saveDebounceTimer == null)
        {
            _saveDebounceTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(NotesEditorConstants.AutosaveDebounceMs)
            };
            _saveDebounceTimer.Tick += OnSaveDebounceTimerTick;
        }

        _saveDebounceTimer.Stop();
        _saveDebounceTimer.Start();
        _saveTimerRunning = true;
    }

    private async void OnSaveDebounceTimerTick(object? sender, EventArgs e)
    {
        _saveDebounceTimer?.Stop();
        _saveTimerRunning = false;

        var noteToSave = _pendingSaveNote;
        _pendingSaveNote = null;

        if (DataContext is not NotesViewModel vm)
            return;

        var editor = GetBlockEditor();
        if (editor == null)
            return;

        var targetNote = noteToSave ?? vm.SelectedNote;
        if (targetNote == null)
            return;

        var perf = EditorPerfDiagnostics.Resolve();
        var tickStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        var currentFingerprint = editor.ComputeContentFingerprint();
        if (_lastSavedFingerprint is { } last
            && last.NoteId == targetNote.NoteId
            && last.Fingerprint == currentFingerprint)
        {
            EditorPerfDiagnostics.RecordPhase(perf, tickStart, "autosave.skippedUnchanged");
            return;
        }

        var blocks = editor.GetBlocks();

        var saveStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        if (noteToSave != null)
            await vm.SaveNoteWithContentAsync(noteToSave, blocks, null);
        else
            await vm.SaveCurrentNoteAsync(blocks, null);
        EditorPerfDiagnostics.RecordPhase(perf, saveStart, "autosave.persist", $"blocks={blocks.Length}");

        _lastSavedFingerprint = (targetNote.NoteId, currentFingerprint);

        EditorPerfDiagnostics.RecordIfSlow(
            perf,
            "autosave.tick",
            EditorPerfDiagnostics.ElapsedMs(tickStart),
            $"blocks={blocks.Length} note={targetNote.NoteId}");
    }

    private void FlushPendingSave()
    {
        if (_saveTimerRunning)
            OnSaveDebounceTimerTick(null, EventArgs.Empty);
    }

    private void OnBlockEditorOpenReferencedNote(string noteId)
    {
        if (DataContext is NotesViewModel vm)
            vm.NavigateToNoteById(noteId);
    }

    private async Task FlushEditorToSelectedNoteAsync()
    {
        if (DataContext is not NotesViewModel vm || vm.SelectedNote == null)
            return;
        var editor = GetBlockEditor();
        if (editor == null)
            return;
        await vm.SaveNoteWithContentAsync(vm.SelectedNote, editor.GetBlocks(), null).ConfigureAwait(true);
    }

    private async void OnTitleBoxLostFocus(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not NotesViewModel vm || vm.SelectedNote == null)
            return;

        var titleBox = sender as TextBox;
        if (titleBox != null)
            await vm.SaveCurrentNoteAsync(null, titleBox.Text);
    }

    private void TeardownSave()
    {
        FlushPendingSave();

        var titleBox = this.FindControl<TextBox>("NoteTitleBox");
        if (titleBox != null)
            titleBox.LostFocus -= OnTitleBoxLostFocus;

        var editor = GetBlockEditor();
        if (editor != null)
        {
            if (_editorOpenNoteWired)
            {
                editor.OpenReferencedNote -= OnBlockEditorOpenReferencedNote;
                _editorOpenNoteWired = false;
            }
            if (_blocksChangedSubscribed)
            {
                editor.BlocksChanged -= OnBlockEditorBlocksChanged;
                _blocksChangedSubscribed = false;
            }
        }

        if (_saveDebounceTimer != null)
        {
            _saveDebounceTimer.Stop();
            _saveDebounceTimer.Tick -= OnSaveDebounceTimerTick;
            _saveDebounceTimer = null;
            _saveTimerRunning = false;
        }
        _cachedBlockEditor = null;
    }
}
