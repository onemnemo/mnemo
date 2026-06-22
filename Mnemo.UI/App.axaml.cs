using System;
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
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Updates;
using Mnemo.UI.Modules.Onboarding.Views;
using Mnemo.UI.Modules.Updates.Services;
using Mnemo.UI.Mcp;
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

        // Start MCP server in the background after DI is ready.
        _ = Task.Run(async () =>
        {
            try
            {
                var mcpServer = Services?.GetService<MnemoMcpServer>();
                if (mcpServer != null)
                    await mcpServer.StartAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                Services?.GetService<ILoggerService>()?.Error("MnemoMcpServer", "Failed to start MCP tool server.", ex);
            }
        });

        desktop.Exit += (_, _) =>
        {
            try
            {
                // Dispose the MCP server synchronously-safe via GetAwaiter (shutdown path).
                (Services?.GetService(typeof(MnemoMcpServer)) as IAsyncDisposable)
                    ?.DisposeAsync().AsTask().GetAwaiter().GetResult();
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

    private static void OnProcessExit(object? sender, EventArgs e) { }

    private static void OnUnhandledException(object? sender, UnhandledExceptionEventArgs e) { }

    private void DisableAvaloniaDataAnnotationValidation()
    {
        // Avalonia 12 removed public binding plugin access; no-op is intentional.
    }
}
