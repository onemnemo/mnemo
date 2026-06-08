using Avalonia.Controls;
using Avalonia.Markup.Xaml;
using Mnemo.Core.Services;

namespace Mnemo.UI.Components.Overlays;

public partial class PerfDiagnosticsOverlay : UserControl
{
    private readonly IPerfDiagnostics? _perf;

    public PerfDiagnosticsOverlay()
    {
        InitializeComponent();
    }

    public PerfDiagnosticsOverlay(IPerfDiagnostics perf)
    {
        _perf = perf;
        InitializeComponent();

        var reportText = this.FindControl<TextBox>("ReportText")!;
        var refreshButton = this.FindControl<Button>("RefreshButton")!;
        var clearButton = this.FindControl<Button>("ClearButton")!;
        var captureMemoryButton = this.FindControl<Button>("CaptureMemoryButton")!;

        reportText.Text = _perf.FormatReport();
        refreshButton.Click += (_, _) => reportText.Text = _perf.FormatReport();
        clearButton.Click += (_, _) =>
        {
            _perf.Clear();
            reportText.Text = _perf.FormatReport();
        };
        captureMemoryButton.Click += (_, _) =>
        {
            _perf.CaptureMemorySnapshot("manual");
            reportText.Text = _perf.FormatReport();
        };
    }

    private void InitializeComponent() => AvaloniaXamlLoader.Load(this);
}
