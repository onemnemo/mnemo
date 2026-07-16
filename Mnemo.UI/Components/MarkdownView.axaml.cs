using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Services;

namespace Mnemo.UI.Components;

/// <summary>
/// A view that renders Markdown content using <see cref="IMarkdownRenderer"/> and <see cref="IMarkdownProcessor"/>.
/// When <see cref="StreamingUpdateIntervalMs"/> is set, re-renders are throttled so content can update live during streaming.
/// </summary>
public partial class MarkdownView : UserControl
{
    private readonly IMarkdownProcessor _markdownProcessor;
    private readonly IMarkdownRenderer _markdownRenderer;

    public static readonly StyledProperty<string?> SourceProperty =
        AvaloniaProperty.Register<MarkdownView, string?>(nameof(Source));

    /// <summary>
    /// When &gt; 0, Source changes use a repeating render timer so the UI keeps up with streaming without
    /// restarting the timer on every change (which would otherwise never elapse during continuous updates).
    /// Use for live streaming (e.g. 150–200). When 0 (default), every change triggers an immediate render.
    /// </summary>
    public static readonly StyledProperty<int> StreamingUpdateIntervalMsProperty =
        AvaloniaProperty.Register<MarkdownView, int>(nameof(StreamingUpdateIntervalMs), defaultValue: 0);

    /// <summary>
    /// Leading multiplier for rendered prose (e.g. 1.6). When 0 (default) the user's
    /// Markdown.LineHeight setting applies; set it where a surface needs its own reading
    /// rhythm regardless of the document-wide preference.
    /// </summary>
    public static readonly StyledProperty<double> ProseLineHeightProperty =
        AvaloniaProperty.Register<MarkdownView, double>(nameof(ProseLineHeight), defaultValue: 0);

    /// <summary>
    /// Typographic profile for this surface. Document (default) keeps the classic heading ramp;
    /// Conversation caps headings near body size and steps code down so answers read as prose.
    /// </summary>
    public static readonly StyledProperty<MarkdownRenderProfile> RenderProfileProperty =
        AvaloniaProperty.Register<MarkdownView, MarkdownRenderProfile>(nameof(RenderProfile), defaultValue: MarkdownRenderProfile.Document);

    public string? Source
    {
        get => GetValue(SourceProperty);
        set => SetValue(SourceProperty, value);
    }

    public int StreamingUpdateIntervalMs
    {
        get => GetValue(StreamingUpdateIntervalMsProperty);
        set => SetValue(StreamingUpdateIntervalMsProperty, value);
    }

    public double ProseLineHeight
    {
        get => GetValue(ProseLineHeightProperty);
        set => SetValue(ProseLineHeightProperty, value);
    }

    public MarkdownRenderProfile RenderProfile
    {
        get => GetValue(RenderProfileProperty);
        set => SetValue(RenderProfileProperty, value);
    }

    private ContentControl? _contentHost;
    private bool _isRendering = false;
    private bool _renderRequested = false;
    private DispatcherTimer? _streamingThrottleTimer;
    private double? _explicitFontSize;

    public MarkdownView()
    {
        var sp = ((App)Application.Current!).Services!;
        _markdownProcessor = sp.GetRequiredService<IMarkdownProcessor>();
        _markdownRenderer = sp.GetRequiredService<IMarkdownRenderer>();
        
        var settings = sp.GetRequiredService<ISettingsService>();
        settings.SettingChanged += OnSettingChanged;

        InitializeComponent();
        _contentHost = this.FindControl<ContentControl>("ContentHost");
    }

    private void OnSettingChanged(object? sender, string key)
    {
        if (key.StartsWith("Markdown."))
        {
            _ = Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(RenderAsync);
        }
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _ = RenderAsync();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        StopStreamingTimer();
        var sp = ((App)Application.Current!).Services!;
        var settings = sp.GetRequiredService<ISettingsService>();
        settings.SettingChanged -= OnSettingChanged;
    }

    private void InitializeComponent()
    {
        AvaloniaXamlLoader.Load(this);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == FontSizeProperty)
        {
            // Only a FontSize set on this view itself (locally or via DynamicResource) overrides the
            // user's Markdown.* size settings; the ambient inherited font size must not leak into
            // rendered documents. Inherited changes never fire while a local value is in effect.
            _explicitFontSize = change.Priority <= Avalonia.Data.BindingPriority.LocalValue
                ? FontSize
                : null;
            ScheduleRender();
        }
        else if (change.Property == SourceProperty ||
                 change.Property == ForegroundProperty ||
                 change.Property == IsVisibleProperty ||
                 change.Property == ProseLineHeightProperty ||
                 change.Property == RenderProfileProperty)
        {
            ScheduleRender();
        }
        else if (change.Property == StreamingUpdateIntervalMsProperty)
        {
            StopStreamingTimer();
            if (StreamingUpdateIntervalMs <= 0)
                _ = RenderAsync();
            else
                ScheduleRender();
        }
    }

    /// <summary>
    /// Renders immediately when throttling is off; when throttled, starts a repeating timer once per
    /// streaming session so ticks fire on schedule even if Source changes continuously (e.g. token streaming).
    /// </summary>
    private void ScheduleRender()
    {
        var intervalMs = StreamingUpdateIntervalMs;
        if (intervalMs <= 0)
        {
            StopStreamingTimer();
            _ = RenderAsync();
            return;
        }

        if (_streamingThrottleTimer != null)
            return;

        _streamingThrottleTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(intervalMs)
        };
        _streamingThrottleTimer.Tick += OnStreamingThrottleTick;
        _streamingThrottleTimer.Start();
        _ = RenderAsync();
    }

    private void StopStreamingTimer()
    {
        if (_streamingThrottleTimer != null)
        {
            _streamingThrottleTimer.Tick -= OnStreamingThrottleTick;
            _streamingThrottleTimer.Stop();
            _streamingThrottleTimer = null;
        }
    }

    private void OnStreamingThrottleTick(object? sender, EventArgs e)
    {
        if (StreamingUpdateIntervalMs <= 0)
            return;
        _ = RenderAsync();
    }

    private async Task RenderAsync()
    {
        if (_contentHost == null) return;

        // If we are not visible, we can delay rendering until we are, 
        // unless we already have content and just need to clear it.
        var currentSource = Source;
        if (!IsVisible && !string.IsNullOrWhiteSpace(currentSource)) return;

        if (string.IsNullOrWhiteSpace(currentSource))
        {
            _contentHost.Content = null;
            return;
        }

        if (_isRendering)
        {
            _renderRequested = true;
            return;
        }

        _isRendering = true;

        try
        {
            do
            {
                _renderRequested = false;
                currentSource = Source;
                
                if (string.IsNullOrEmpty(currentSource)) break;

                // Process special inlines (LaTeX, etc.) on a background thread
                var (processedSource, specialInlines) = await Task.Run(() => 
                    _markdownProcessor.ExtractSpecialInlines(currentSource));

                // Render the processed markdown - must be on UI thread
                await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(async () =>
                {
                    try
                    {
                        var lineHeight = ProseLineHeight > 0 ? ProseLineHeight : (double?)null;
                        var renderedControl = await _markdownRenderer.RenderAsync(processedSource, specialInlines, Foreground, _explicitFontSize, lineHeight, RenderProfile);
                        _contentHost.Content = renderedControl;
                    }
                    catch (Exception ex)
                    {
                        _contentHost.Content = new TextBlock
                        {
                            Text = $"Error rendering markdown: {ex.Message}",
                            Foreground = Brushes.Red,
                            TextWrapping = TextWrapping.Wrap
                        };
                    }
                });

            } while (_renderRequested);
        }
        catch (Exception ex)
        {
            await Avalonia.Threading.Dispatcher.UIThread.InvokeAsync(() =>
            {
                _contentHost.Content = new TextBlock
                {
                    Text = $"Error processing content: {ex.Message}",
                    Foreground = (IBrush?)Application.Current?.FindResource("SystemErrorBackgroundBrush") ?? Brushes.Red,
                    TextWrapping = TextWrapping.Wrap
                };
            });
        }
        finally
        {
            _isRendering = false;
        }
    }
}
