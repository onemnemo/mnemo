# .NET, C#, and Avalonia

## Async and concurrency

- All I/O and long-running work is `async`/`await` returning `Task` or `Task<T>`.
- Accept a `CancellationToken` on anything cancellable or long, and honour it once it is
  passed in.
- Use `ConfigureAwait(false)` in library and non-UI code.
- Report progress with `IProgress<T>` where a caller can use it.
- `TaskExecutionMode.Exclusive` for resource-heavy work such as local model inference,
  `TaskExecutionMode.Parallel` for lightweight independent I/O.
- Never block on async. No `.Result`, no `.Wait()`, no `GetAwaiter().GetResult()`.
- Use the right concurrent structure (`ConcurrentDictionary` and friends) rather than locking
  a plain one.

## Errors

- Throw for exceptional failures. Use `Result<T>` or a boolean for expected outcomes that are
  part of normal flow.
- Never swallow an exception. An empty catch, or a catch that logs nothing, is a defect.
- Catch at clear boundaries: the UI, the service or API edge. Not in the middle of a call
  chain where the caller could have handled it better.
- Log with context, structured where possible. "Failed to load" with no identifier is not a
  log line, it is noise.
- Do not use exceptions as control flow.

## Lifecycle

- Unsubscribe from events and dispose what you own. A leak in a long-running desktop app is a
  bug that only shows up for the users who like the product most.
- Lazy-load heavy resources rather than loading everything at startup.

## MVVM and Avalonia

- Logic lives in ViewModels and services. Views are declarative XAML. No business logic in
  code-behind.
- Bind to dynamic theme brushes rather than fixed colors.
- Prefer built-in controls, then styles and templates. Write a custom control only when
  neither can express it.
- Every user-facing string is localized. No hard-coded UI text.
- Keep the UI thread responsive.
- `CommunityToolkit.Mvvm` (`ObservableObject`, `RelayCommand`) uses source generators, so
  check the generated code when a command or property misbehaves.

Layout rules that Avalonia does not enforce and will silently ignore:

- `StackPanel` and `Grid` do not take `Padding`.
- `StackPanel` and `Grid` do not take `CornerRadius`.
- Use `Margin`, or wrap the content in a `Border`.

## Documentation

- XML `<summary>` on public members, capturing behavior plus the edge cases a caller needs
  (what happens on null, on empty, on not found).
- Explain non-obvious business rules and algorithms. Do not restate the code.
