using System;
using System.Collections.Concurrent;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Data;
using Avalonia.Markup.Xaml;
using Avalonia.Markup.Xaml.MarkupExtensions;
using Avalonia.VisualTree;
using Mnemo.Core;
using Mnemo.Core.Services;

namespace Mnemo.UI.Markup
{
    /// <summary>
    /// Markup extension for localized text. Usage: Text="{ui:T Ns=Settings, Key=Title}".
    /// Resolves <see cref="ILocalizationService"/> from the application service provider (markup has no DI context).
    /// </summary>
    public class TExtension : MarkupExtension
    {
        public string? Ns { get; set; }
        public string? Key { get; set; }
        /// <summary>Optional value converter applied to the localized string (e.g. uppercasing section labels).</summary>
        public Avalonia.Data.Converters.IValueConverter? Converter { get; set; }

        private sealed class LocalizationBindingSource : AvaloniaObject, System.ComponentModel.INotifyPropertyChanged
        {
            private readonly ILocalizationService _loc;
            public string Ns { get; }
            public string Key { get; }
            public new event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;

            public LocalizationBindingSource(ILocalizationService loc, string ns, string key)
            {
                _loc = loc;
                Ns = ns;
                Key = key;
                _loc.LanguageChanged += (_, __) => PropertyChanged?.Invoke(this, new System.ComponentModel.PropertyChangedEventArgs(nameof(Value)));
            }

            public string Value => _loc.T(Key, Ns);
        }

        public override object ProvideValue(IServiceProvider serviceProvider)
        {
            var loc = ((App)Application.Current!).Services!.GetService(typeof(ILocalizationService)) as ILocalizationService;
            if (loc == null || string.IsNullOrWhiteSpace(Ns) || string.IsNullOrWhiteSpace(Key))
                return new Binding();

            var source = new LocalizationBindingSource(loc, Ns!, Key!);
            return new Binding
            {
                Source = source,
                Path = nameof(LocalizationBindingSource.Value),
                Mode = BindingMode.OneWay,
                Converter = Converter
            };
        }
    }

    public static class Localization
    {
        // Host is TextBlock for simplicity; extend similarly for other controls if needed
        public static readonly AttachedProperty<string?> NamespaceProperty =
            AvaloniaProperty.RegisterAttached<TextBlock, string?>("Namespace", typeof(Localization));

        public static void SetNamespace(AvaloniaObject element, string? value) => element.SetValue(NamespaceProperty, value);
        public static string? GetNamespace(AvaloniaObject element) => element.GetValue(NamespaceProperty);

        public static readonly AttachedProperty<string?> TextKeyProperty =
            AvaloniaProperty.RegisterAttached<TextBlock, string?>("TextKey", typeof(Localization));

        public static void SetTextKey(AvaloniaObject element, string? value) => element.SetValue(TextKeyProperty, value);
        public static string? GetTextKey(AvaloniaObject element) => element.GetValue(TextKeyProperty);

        private static readonly ConcurrentDictionary<TextBlock, byte> _registered = new();
        private static bool _languageChangeHandlerRegistered = false;

        static Localization()
        {
            NamespaceProperty.Changed.AddClassHandler<TextBlock>((tb, _) => OnAttached(tb));
            TextKeyProperty.Changed.AddClassHandler<TextBlock>((tb, _) => OnAttached(tb));
        }

        private static void OnAttached(TextBlock? tb)
        {
            if (tb == null) return;
            tb.DetachedFromVisualTree += OnDetachedFromVisualTree;
            Update(tb);
        }

        private static void OnDetachedFromVisualTree(object? sender, VisualTreeAttachmentEventArgs e)
        {
            if (sender is TextBlock tb)
            {
                tb.DetachedFromVisualTree -= OnDetachedFromVisualTree;
                _registered.TryRemove(tb, out _);
            }
        }

        private static void EnsureLanguageChangeHandler()
        {
            if (_languageChangeHandlerRegistered) return;
            
            var loc = ((App)Application.Current!).Services!.GetService(typeof(ILocalizationService)) as ILocalizationService;
            if (loc != null)
            {
                loc.LanguageChanged += (_, __) => BroadcastUpdate();
                _languageChangeHandlerRegistered = true;
            }
        }

        private static void BroadcastUpdate()
        {
            // Ensure UI updates happen on the UI thread
            Avalonia.Threading.Dispatcher.UIThread.Post(() =>
            {
                foreach (var kv in _registered.Keys)
                {
                    Update(kv);
                }
            });
        }

        private static void Update(TextBlock? tb)
        {
            if (tb == null) return;
            _registered.TryAdd(tb, 0);

            EnsureLanguageChangeHandler();

            var ns = GetNamespace(tb);
            var key = GetTextKey(tb);
            if (string.IsNullOrWhiteSpace(ns) || string.IsNullOrWhiteSpace(key)) return;

            var loc = ((App)Application.Current!).Services!.GetService(typeof(ILocalizationService)) as ILocalizationService;
            if (loc == null) return;
            tb.Text = loc.T(key!, ns!);
        }
    }
}



