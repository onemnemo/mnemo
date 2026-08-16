<p align="center">
  <img width="600" alt="logo" src="https://github.com/user-attachments/assets/7e52d41a-f3d9-42fe-ada7-d44c6b3da574" />
</p>

<div align="center">

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Status](https://img.shields.io/badge/status-Beta-blue.svg)](https://github.com/onemnemo/mnemo/releases)
![Framework](https://img.shields.io/badge/framework-.NET%2010.0-purple.svg)
![UI](https://img.shields.io/badge/UI-React%20%2B%20PhotinoX-orange.svg)

<div align="center">Free. Open source. Local first. Built by learners, for learners.</div>

</div>

## What is Mnemo?

Mnemo is a study application. Notes, flashcards, mindmaps and progress tracking live in one place, on your own machine, in a single window.

The interface is a React and TypeScript app rendered in a native window by [PhotinoX](https://github.com/ivanvoyager/PhotinoX) and served by a local .NET 10 host, so it looks and behaves like a desktop app without shipping a bundled browser inside it.

> No subscriptions. No ads. No accounts. No tracking.

Your work stays in a local database and a folder of files under your own user data directory. Nothing is sent anywhere unless you explicitly turn on a feature that needs the network.

## Screenshots

<table>
<tr>
<td width="50%">

**Notes Editor**

![Notes editor](https://www.mnemo.one/screenshots/notes.png)

</td>
<td width="50%">

**Flashcards Module**

![Flashcard review](https://www.mnemo.one/screenshots/flashcards.png)

</td>
</tr>
<tr>
<td colspan="2">

**Mindmap**

![Mindmap](https://www.mnemo.one/screenshots/mindmaps.png)

</td>
</tr>
</table>

## What is inside

**Notes.** A block editor built for documents that get long. Headings, lists, checklists, quotes, callouts, code, math, images, two column layouts, dividers and links to other pages, with inline formatting, highlights and colours. Multiple notes open as tabs, the tree in the sidebar can be reorganised by dragging, and there is find and replace. Notes export to Markdown, to a `.mnemo` package that keeps a whole folder intact, and to PDF through a bundled Typst compiler with a live preview and real typesetting options.

**Flashcards.** Decks and folders, classic and cloze cards, and scheduling by FSRS. Study sessions track state per card, and a separate self graded test mode exists for when you want to check yourself rather than schedule a review. Decks import and export as Anki packages, CSV, or `.mnemo`.

**Mindmaps.** An infinite canvas written from scratch for this app rather than assembled from a diagram library. Nodes, shapes, free text, images and frames, six layout algorithms, edge routing and styling, reusable style templates, a minimap, and a searchable library with folders. Maps export as PNG, SVG or a Markdown outline.

**Overview.** A dashboard you arrange yourself, with thirteen widgets covering today's queue, streaks, a year long activity heatmap, review forecasts, retention, leeches, goals, recent notes and more. Widgets can be dragged, resized and swapped out from a gallery.

**Everything around it.** Light and dark themes, five interface languages (English, German, Spanish, Japanese, Norwegian Bokmål), remappable keyboard shortcuts, a command palette, toasts and a notification history, and a settings surface that covers all of it.

## Project status

Mnemo is at **0.8.0-beta**, and the first packaged release is close.

- **Windows** is the only platform with a tested installer today. It is built with Velopack and ships as a normal `.exe` installer plus a portable zip.
- **macOS and Linux** compile, and the runtime identifiers are in place, but no package for either has been built and run end to end yet, so neither is published. Publishing downloads nobody has tested would be worse than publishing none.
- Builds are **not code signed** yet, so Windows SmartScreen will warn on first run.
- The app is stable in daily use, and it is still pre release software. Expect rough edges, and keep a backup of anything you would be upset to lose.

Application data lives in `%LOCALAPPDATA%\Mnemo` on Windows, and under the local application data directory on other platforms. The log folder and the data folder can both be opened from Settings, under About.

## The assistant

Mnemo has an optional assistant called Soma. It is **off by default**, and while it is off nothing about it appears in the app: no sidebar entry, no dock, no widget.

Turning it on requires your own [OpenRouter](https://openrouter.ai) key. Chat, model selection and streaming replies work today, along with an experimental agent mode that lets a model call Mnemo's own tools to read and edit notes, mindmaps and settings. Agent mode is off by default and has no permission prompt or undo receipt yet, so it is genuinely experimental rather than politely labelled as such.

Running models **locally** is where this is meant to end up, and it does not work yet. The provider selector already shows a Local option, and it stays disabled until there is an implementation worth shipping. Until then the assistant is cloud only, and the request goes to OpenRouter and nowhere else.

The rest of the AI work, having assistance available inside the editor and the study modules instead of in a separate chat window, with a real permission model behind it, is mostly still ahead. Mnemo is a study app that can use a model, not a chat app with study features attached, and the plan is to keep it that way.

## Roadmap

Direction rather than dates, roughly in the order it matters:

- Local model support, so the assistant works offline and nothing leaves the machine
- Assistance built into the modules, behind a permission model with previews and undo
- Full text search across notes and cards, not just titles
- A document reader for PDFs and slides, with highlights that turn into cards
- Study games and interactive practice
- Optional sync, self hosted or hosted, never required and never the default
- An extension system, so modules, themes and languages can be installed rather than compiled in
- macOS and Linux packages

## Architecture

Mnemo is a web frontend and a .NET backend that ship as one application.

- **mnemo-web**: the user interface. A React, TypeScript and Tailwind CSS single page app built with Vite. Almost all feature and UI work happens here.
- **Mnemo.Host**: the application host. A .NET 10 process that opens the native window with PhotinoX, runs a loopback only Kestrel server for the app's HTTP API, and serves the built frontend. This is the executable that ships.
- **Mnemo.Core**: shared models, interfaces and contracts. No external dependencies, and the foundation everything else builds on.
- **Mnemo.Infrastructure**: the implementations behind those contracts, including storage, notes, flashcards, mindmaps, import and export, and the AI stack.
- **Mnemo.UI**: the previous Avalonia interface. It is no longer the app, and it is never launched by the shipped build, but the feature modules still live in that assembly and are loaded from it during startup, so it stays in the build until those modules are relocated.

## Project structure

```text
MnemoApp/
├── mnemo-web/                 # React + TypeScript single page app (the UI)
│   ├── src/
│   │   ├── api/                # Typed client for the Mnemo.Host HTTP API
│   │   ├── components/         # Shared components, app shell and chrome
│   │   ├── styles/             # Design tokens and global styles
│   │   └── ...                 # One folder per feature area (notes, flashcards,
│   │                             mindmap, overview, settings, chat, ...)
│   └── public/                 # Static assets, including bundled fonts
├── Mnemo.Host/                # .NET host: PhotinoX window + local API server
│   ├── Composition/            # Dependency injection and startup wiring
│   ├── Chrome/                 # Native window frame and chromeless titlebar
│   ├── Startup/                # Kestrel, crash logging and dev server bootstrap
│   ├── Web/                    # Static file and single page app serving
│   ├── TypstRuntime/           # Bundled Typst compiler and fonts for PDF export
│   └── ...                     # One folder per API area (Notes, Flashcards, Ai, ...)
├── Mnemo.Core/                # Shared models, interfaces and contracts
├── Mnemo.Infrastructure/      # Service implementations and language bundles
├── Mnemo.UI/                  # Previous Avalonia UI, still hosting the feature modules
├── scripts/                   # Typst binary restore, pinned by manifest
└── *.Tests/                   # xUnit test projects
```

## Tech stack

**Frontend**

- **React 19** and **TypeScript**, built and served by **Vite**
- **Tailwind CSS 4**, driven by a shared design token system
- **Zustand** and **TanStack Query** for state and server data
- **ProseMirror** for the notes editor, **KaTeX** for math, **pdf.js** for PDF preview
- **Vitest** for tests and **oxlint** for linting

**Backend**

- **.NET 10** and **ASP.NET Core (Kestrel)**, bound to loopback with an ephemeral port and a bearer token
- **[PhotinoX](https://github.com/ivanvoyager/PhotinoX)**, which opens the native window and renders the UI in the operating system's own web view
- **SQLite** for local storage
- **Typst** for PDF export, bundled and pinned
- **Velopack** for installers and updates
- **Markdig** and **PdfPig** for Markdown and PDF handling
- **OpenRouter** for the optional assistant, using your own key

## Install

1. [Download the latest release](https://github.com/onemnemo/mnemo/releases/latest).
2. Run the Windows installer, or unpack the portable zip if you would rather not install anything.
3. Windows will warn about an unrecognised app because the build is unsigned. Choose More info, then Run anyway.

macOS and Linux packages are not published yet. See [Project status](#project-status).

For a step by step guide, see the [installation documentation](https://www.mnemo.one/docs/students/installing).

## Build from source

### Prerequisites

- .NET 10 SDK
- Node.js 22 or later, with npm
- Windows, Linux or macOS (only Windows is regularly exercised today)

### Running in development

The frontend and the host run separately during development, one per terminal.

```bash
cd mnemo-web
npm install
npm run dev
```

```bash
dotnet run --project Mnemo.Host -- --dev
```

`--dev` points the host at the Vite dev server instead of a built copy of the frontend, and opens the window once both are ready.

On Windows, `dev.bat` starts both of them for you, each in its own terminal, and installs the web dependencies on first run.

PDF export needs the pinned Typst binary, which is not committed. Restore it once after cloning:

```bash
./scripts/restore-typst.ps1
```

On Linux and macOS, use `./scripts/restore-typst.sh` instead.

### Running a production build

Without `--dev`, the host serves a built copy of the frontend and will refuse to start without one.

```bash
cd mnemo-web
npm run build
```

```bash
MNEMO_SPA_ROOT=mnemo-web/dist dotnet run --project Mnemo.Host
```

On Windows PowerShell, set the variable first with `$env:MNEMO_SPA_ROOT = "mnemo-web/dist"`.

`dotnet publish` copies `mnemo-web/dist` into a `wwwroot` beside the executable, so a published build finds the frontend without any environment variable.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [coding-standard.md](coding-standard.md) before opening a pull request, and look for issues labelled `good first issue` if you are new here.

Documentation lives at [mnemo.one/docs](https://www.mnemo.one/docs/students).

## License

Apache License 2.0. See [LICENSE](LICENSE) for the full text, [NOTICE](NOTICE) for attribution, and [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES) for bundled dependencies.

The Mnemo name, logo and visual identity are covered separately by [BRAND.md](BRAND.md).

---

> "Education is not the learning of facts, but the training of the mind to think."
> Albert Einstein
