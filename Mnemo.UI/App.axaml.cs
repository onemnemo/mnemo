using System;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Controls.Primitives;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.AI;
using Mnemo.Infrastructure.Services.Updates;
using Mnemo.UI.Modules.Onboarding.Views;
using Mnemo.UI.Modules.Updates.Services;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;
using Mnemo.UI.Views;

namespace Mnemo.UI;

public partial class App : Application
{
    /// <summary>
    /// Gap between anchor and flyout. Theme <c>Style</c> selectors do not hit <see cref="Flyout"/> / <see cref="MenuFlyout"/>
    /// (they are not visual children until opened). Submenus use <see cref="Popup"/> in MenuItem templates, not <see cref="PopupFlyoutBase"/>.
    /// </summary>
    private const double FlyoutAnchorGap = 8;

    static App()
    {
        PopupFlyoutBase.VerticalOffsetProperty.OverrideDefaultValue<PopupFlyoutBase>(FlyoutAnchorGap);
        ContextMenu.VerticalOffsetProperty.OverrideDefaultValue<ContextMenu>(FlyoutAnchorGap);
    }

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public IServiceProvider? Services { get; private set; }

    public override void OnFrameworkInitializationCompleted()
    {
        // Avalonia expects startup (including base.OnFrameworkInitializationCompleted) to finish synchronously
        // in this callback; deferring DI/MainWindow via Task.Run breaks desktop lifetime/window creation.
        Services = Bootstrapper.Build();
        var navService = Services.GetRequiredService<INavigationService>();
        var themeService = Services.GetRequiredService<IThemeService>();

        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;

        _ = themeService.GetCurrentThemeAsync().ContinueWith(t =>
        {
            if (t.IsCompletedSuccessfully)
            {
                _ = themeService.ApplyThemeAsync(t.Result);
            }
        }, TaskScheduler.FromCurrentSynchronizationContext());

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            DisableAvaloniaDataAnnotationValidation();
            var mainWindow = new MainWindow
            {
                DataContext = Services.GetRequiredService<MainWindowViewModel>(),
            };

            void OnMainWindowLoadedOnce(object? _, RoutedEventArgs __)
            {
                mainWindow.Loaded -= OnMainWindowLoadedOnce;
                _ = RunPostLaunchFlowsAsync();
            }

            mainWindow.Loaded += OnMainWindowLoadedOnce;
            desktop.MainWindow = mainWindow;

            desktop.Exit += (_, _) =>
            {
                try
                {
                    DisposeServerManagerIfCreated();
                    (Services?.GetService(typeof(ITextGenerationService)) as IDisposable)?.Dispose();
                    (Services?.GetService(typeof(IResourceGovernor)) as IDisposable)?.Dispose();
                    (Services?.GetService(typeof(IEmbeddingService)) as IDisposable)?.Dispose();
                }
                catch
                {
                    // Ignore disposal errors during shutdown
                }

                AppDomain.CurrentDomain.ProcessExit -= OnProcessExit;
                AppDomain.CurrentDomain.UnhandledException -= OnUnhandledException;

                if (Services is IDisposable disposable)
                {
                    disposable.Dispose();
                }
            };
        }

        navService.NavigateTo("overview");

        base.OnFrameworkInitializationCompleted();
    }

    private async Task RunPostLaunchFlowsAsync()
    {
        try
        {
            await ShowOnboardingIfNeededAsync().ConfigureAwait(false);
        }
        catch
        {
            // Keep startup resilient if onboarding flow fails.
        }

        try
        {
            await RunHardwareInstallMismatchCheckAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Services?.GetService<ILoggerService>()?.Error("Hardware", "RunHardwareInstallMismatchCheckAsync threw.", ex);
        }

        try
        {
            Services?.GetService<UpdateOrchestrator>()?.Start();
        }
        catch (Exception ex)
        {
            Services?.GetService<ILoggerService>()?.Error("Updates", "UpdateOrchestrator.Start threw.", ex);
        }

        try
        {
            await ShowPostUpdateToastIfNeededAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Services?.GetService<ILoggerService>()?.Error("Updates", "ShowPostUpdateToastIfNeededAsync threw.", ex);
        }

        try
        {
            Services?.GetService<UpdateOrchestrator>()?.ArmRebuildNotice();
        }
        catch (Exception ex)
        {
            Services?.GetService<ILoggerService>()?.Error("Updates", "ArmRebuildNotice threw.", ex);
        }
    }

    private async Task ShowPostUpdateToastIfNeededAsync()
    {
        if (Services == null)
            return;

        var settings = Services.GetRequiredService<ISettingsService>();
        var ver = await settings.GetAsync<string?>(UpdateSettingsKeys.PendingPostUpdateToastVersion).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(ver))
            return;

        var toastsEnabled = await settings.GetAsync(ToastService.EnableToastsSettingKey, true).ConfigureAwait(false);
        if (!toastsEnabled)
            return;

        await settings.SetAsync<string?>(UpdateSettingsKeys.PendingPostUpdateToastVersion, null).ConfigureAwait(false);

        var toast = Services.GetRequiredService<IToastService>();
        var loc = Services.GetRequiredService<ILocalizationService>();
        var title = loc.T("PostUpdateToastTitle", "Settings");
        var description = string.Format(loc.T("PostUpdateToastDescriptionFormat", "Settings"), ver);
        toast.SpawnToast(ToastType.Info, TimeSpan.FromSeconds(5), title, description);
    }

    private void DisposeServerManagerIfCreated()
    {
        if (Services == null)
            return;
        (Services.GetService(typeof(IAIServerManager)) as IDisposable)?.Dispose();
    }

    private async Task RunHardwareInstallMismatchCheckAsync()
    {
        await Task.Delay(1500).ConfigureAwait(false);
        if (Services == null)
        {
            return;
        }

        var settings = Services.GetRequiredService<ISettingsService>();
        var onboardingDone = await settings.GetAsync("Onboarding.Completed", false).ConfigureAwait(false);
        var registry = Services.GetRequiredService<IAIModelRegistry>();
        await registry.RefreshAsync().ConfigureAwait(false);

        var models = await registry.GetAvailableModelsAsync().ConfigureAwait(false);
        var hasMid = models.Any(m => m.Type == AIModelType.Text && m.Role == AIModelRoles.Mid);
        var hasHigh = models.Any(m => m.Type == AIModelType.Text && m.Role == AIModelRoles.High);

        var detector = Services.GetRequiredService<HardwareDetector>();
        var hardware = detector.Detect();
        var tierEval = Services.GetRequiredService<IHardwareTierEvaluator>();
        var tier = tierEval.EvaluateTier(hardware);

        var mismatch =
            (tier == HardwarePerformanceTier.Low && (hasMid || hasHigh)) ||
            (tier == HardwarePerformanceTier.Mid && hasHigh);

        if (!mismatch)
        {
            return;
        }

        var logger = Services.GetRequiredService<ILoggerService>();
        logger.Warning(
            "Hardware",
            $"Detected hardware tier ({tier}) is below installed text model tiers. Mid installed: {hasMid}, High installed: {hasHigh}. VRAM reported: {hardware.TotalVramBytes / 1024 / 1024} MB.");

        if (!onboardingDone)
        {
            return;
        }

        var loc = Services.GetRequiredService<ILocalizationService>();
        var title = loc.T("ModelTierMismatchTitle", "Hardware");
        var message = loc.T("ModelTierMismatchMessage", "Hardware");

        await Dispatcher.UIThread.InvokeAsync(async () =>
        {
            if (Services == null)
            {
                return;
            }

            var overlay = Services.GetRequiredService<IOverlayService>();
            await overlay.CreateDialogAsync(title, message, loc.T("OK", "Common"), "").ConfigureAwait(false);
        });
    }

    private async Task ShowOnboardingIfNeededAsync()
    {
        if (Services == null) return;
        var settingsService = Services.GetRequiredService<ISettingsService>();
        var completed = await settingsService.GetAsync("Onboarding.Completed", false).ConfigureAwait(false);
        if (completed) return;

        var vm = Services.GetRequiredService<Mnemo.UI.Modules.Onboarding.ViewModels.OnboardingWizardViewModel>();

        try
        {
            await vm.LoadUserNameAsync().ConfigureAwait(false);
        }
        catch
        {
            // Ignore and keep onboarding usable without prefilled name.
        }

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            if (Services == null) return;
            var overlayService = Services.GetRequiredService<IOverlayService>();
            var view = new OnboardingWizardView { DataContext = vm };
            var options = new OverlayOptions
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                ShowBackdrop = true,
                CloseOnOutsideClick = false,
                CloseOnEscape = false
            };
            var id = overlayService.CreateOverlay(view, options, "OnboardingWizard");
            vm.SetOverlayId(id);
        }, DispatcherPriority.Normal);
    }

    private static void OnProcessExit(object? sender, EventArgs e)
    {
        ShutdownServerManager();
    }

    private static void OnUnhandledException(object? sender, UnhandledExceptionEventArgs e)
    {
        try
        {
            ShutdownServerManager();
        }
        catch
        {
            // Ignore disposal errors during crash
        }
    }

    private static void ShutdownServerManager()
    {
        try
        {
            if (Current is App app)
                app.DisposeServerManagerIfCreated();
        }
        catch
        {
            // Ignore disposal errors during process exit or crash
        }
    }

    private void DisableAvaloniaDataAnnotationValidation()
    {
        // Avalonia 12 removed public binding plugin access; no-op is intentional.
    }
}
