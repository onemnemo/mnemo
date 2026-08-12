<!-- <img src="https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmFuYWZwOXFzNHlmOWQzZjJwYWM3czJka2F3dGQweWxkdHk3M3B1MyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/96bvdlba25M2hrewuc/giphy.gif" width="100%"> -->

<p align="center">
  <img width="600" alt="logo" src="https://github.com/user-attachments/assets/7e52d41a-f3d9-42fe-ada7-d44c6b3da574" />
</p>


<div align="center">

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Status](https://img.shields.io/badge/status-In_Development-blue.svg)](https://github.com/onemnemo/mnemo)
![Framework](https://img.shields.io/badge/framework-.NET%2010.0-purple.svg)
![UI](https://img.shields.io/badge/UI-React%20%2B%20PhotinoX-orange.svg)

<div align="center">Free. Open-source. Cross-platform. Built by learners, for learners.</div>

</div>

## What is Mnemo?

Mnemo is a fully modular, cross-platform learning platform. Its interface is a React and TypeScript web app, rendered in a native window by **PhotinoX** and served locally by a **.NET 10** host, so it looks and feels like a desktop app without shipping a bundled browser.

It brings flashcards, notes, mind maps, learning paths, games, and more into one focused app.

> No subscriptions. No ads. No tracking. Ever.

Mnemo is designed to be:

* **Extensible**: Features are built as modular parts that can grow independently.
* **Customizable**: Themes, languages, fonts, colors, sizing, and localization can all be adjusted.
* **Cross-platform**: Runs on Windows, macOS, and Linux.
* **Accessible**: Includes support features aimed at making learning more inclusive.


## Screenshots

<table>
<tr>
<td width="50%">

**Overview**

![Overview-Edit](https://www.mnemo.one/images/overview.png)

</td>
<td width="50%">

**Notes Editor**

![Unit-View](https://www.mnemo.one/images/notes-editor-2.png)

</td>
</tr>
<tr>
<td width="50%">

**Flashcards Module**

![NotesEditor](https://www.mnemo.one/images/flashcard.png)

</td>
<td width="50%">

**Mindmap**

![Account Settings](https://www.mnemo.one/images/mindmap.png)

</td>
</tr>
</table>

## Current Status

Mnemo is under active development and not yet feature-complete.

**What works today:**
- Core application shell and navigation
- Mindmaps
- Block based notes editor
- Flashcard module with various algorithms
- Basic Widget system
- Theming, settings, and localization infrastructure


## Features (WIP)

- **AI-Powered Text Generation**: Cloud AI chat and text generation through OpenRouter, with model routing and per-conversation summarization
- **Knowledge Management**: Vector-based RAG (Retrieval-Augmented Generation) with semantic search and embeddings
- **Learning Paths**: AI-generated personalized learning paths from your knowledge base
- **Rich Text**: Markdown support with custom LaTeX rendering for mathematical expressions
- **Modular Architecture**: Extensible module system with auto-discovery
- **Theming**: Customizable themes
- **Localization**: Multi-language support infrastructure
- **Modules**:
  - **Overview**: Dashboard and welcome screen
  - **Notes**: Rich text note-taking with block-based editor
  - **Chat**: AI-powered conversational interface
  - **Mindmap**: Visual knowledge mapping
  - **Path**: Learning path creation and management
  - **Settings**: Comprehensive application configuration

> Note: Many features are under active development and may be incomplete or disabled in current builds.

### Roadmap
- **Flashcards** with spaced repetition algorithms (Anki, Quizlet...)
- **Text notes** and organization tools
- **Mindmaps** to visualize concepts
- **Learning paths** structured ways to learn
- **Games** powered by the same engine as *Stardew Valley* (known as [Monogame](https://monogame.net/))
- **Explore** a place to download games, extensions, themes, languages etc.
- **Progress analytics** track your study progress
- **Extension development** create fully integrated extensions
- **Read Aloud, Audio Review, AI-generated video lessons** (done locally)

## Architecture

Mnemo is split into a web frontend and a .NET backend, organized into these layers:

* **mnemo-web**: The user interface. A React, TypeScript, and Tailwind CSS single-page app built with Vite. This is where almost all feature and UI work happens today.
* **Mnemo.Host**: The application host. A .NET 10 process that opens the native app window with PhotinoX, runs a loopback-only ASP.NET Kestrel server for the app's HTTP API, and serves the built mnemo-web app.
* **Mnemo.Core**: Shared models, interfaces, and application contracts. This layer has no external dependencies and serves as the foundation of the application.
* **Mnemo.Infrastructure**: Concrete implementations for core services, including AI integration, storage, and knowledge management.
* **Mnemo.UI**: An older Avalonia-based interface. It is being replaced by mnemo-web and is no longer the primary way to use Mnemo, but Mnemo.Host still references it while the two interfaces coexist, so it remains part of the build.

## Project Structure

```text
MnemoApp/
├── mnemo-web/                 # React + TypeScript single-page app (the UI)
│   ├── src/
│   │   ├── api/                # Typed client for the Mnemo.Host HTTP API
│   │   ├── components/         # Shared UI components (buttons, icons, dialogs...)
│   │   ├── styles/              # Design tokens and global styles
│   │   └── ...                  # One folder per feature module (chat, flashcards,
│   │                              mindmap, notes, overview, settings, ...)
│   └── public/                 # Static assets, including bundled fonts
├── Mnemo.Host/                # .NET application host (PhotinoX window + API server)
│   ├── Composition/            # Dependency injection and startup wiring
│   ├── Startup/                 # Kestrel and dev-server bootstrapping
│   ├── Web/                      # Static file and single-page app serving
│   ├── TypstRuntime/              # Bundled Typst compiler and fonts for PDF export
│   └── ...                         # One folder per feature module (Ai, Chat, Notes, ...)
├── Mnemo.Core/                # Shared models, interfaces, and contracts
│   ├── Models/                 # Domain and data models
│   └── Services/                # Service abstractions
├── Mnemo.Infrastructure/      # Service implementations
│   └── Services/                # AI, storage, and knowledge services
└── Mnemo.UI/                  # Older Avalonia UI, kept for module discovery
    ├── Components/              # Reusable UI components
    ├── Modules/                  # Self-contained feature modules
    ├── Services/                  # UI-specific services
    └── Themes/                    # Styling and theme resources
```

This separation keeps the application easier to maintain, test, and extend as new features are added.


## Tech Stack

**Frontend (mnemo-web)**

* **React 19** and **TypeScript**: Component-based UI
* **Vite**: Dev server and production build
* **Tailwind CSS**: Utility-first styling, driven by a shared design-token system

**Backend**

* **.NET 10.0**: Core runtime and C# platform
* **PhotinoX**: Opens the native app window and renders the UI in the operating system's own web view
* **ASP.NET Core (Kestrel)**: Loopback-only HTTP API server, hosted inside Mnemo.Host
* **OpenRouter**: Cloud AI chat and text generation, with model routing across providers
* **Typst**: Bundled PDF compiler used for exporting notes
* **ONNX Runtime**: Experimental support for embedding model inference
* **SQLite**: Local storage for app data and vectors
* **Markdig**: Markdown parsing and rendering, used by the older Avalonia UI
* **CommunityToolkit.Mvvm**: MVVM helpers and source generators, used by the older Avalonia UI
* **Custom tooling**: Several purpose-built systems and implementations tailored to the app

## Getting Started

### Prerequisites

- .NET 10.0 SDK
- Node.js 18 or later, with npm
- Windows, Linux, or macOS

### Building

Mnemo has two parts to run: the mnemo-web frontend and the Mnemo.Host backend. For
day-to-day development, run each in its own terminal.

```bash
# Terminal 1: frontend dev server (Vite, http://localhost:5173)
cd mnemo-web
npm install
npm run dev
```

```bash
# Terminal 2: backend host in dev mode (API on http://localhost:47210)
dotnet run --project Mnemo.Host -- --dev
```

The `--dev` flag points Mnemo.Host at the Vite dev server above instead of a built
copy of mnemo-web, and opens the app window once both are ready.

Skipping `--dev` starts Mnemo.Host in production mode, which needs an already-built
copy of mnemo-web and will fail to start without one:

```bash
cd mnemo-web
npm run build          # outputs to mnemo-web/dist

# from the repository root, point Mnemo.Host at that build
MNEMO_SPA_ROOT=mnemo-web/dist dotnet run --project Mnemo.Host
```

(On Windows PowerShell, set the environment variable first with
`$env:MNEMO_SPA_ROOT = "mnemo-web/dist"`.)

### Installation

1. [Download the latest release from GitHub](https://github.com/onemnemo/mnemo/releases/latest).
   (This link will navigate you away)
2. Choose the installer for your operating system:

   * Windows: `.exe`
   * Linux: `.AppImage`
   * macOS: `.pkg` *(currently untested)*
3. Open the installer.
4. Follow the setup instructions to install Mnemo.

For a step-by-step guide, see the [installation documentation](https://www.mnemo.one/docs/students/installing).


## Development

See [coding-standard.md](coding-standard.md) for detailed coding standards and architecture guidelines.

## Documentation

Project documentation is available [here](https://www.mnemo.one/docs/students).

### Key Principles

* **Component-based UI**: mnemo-web is organized as one folder per feature module, built from small, focused, swappable components.
* **MVVM pattern** (Mnemo.UI): Keep business logic in ViewModels and make Views focused on presentation.
* **Dependency injection**: Register services through the DI container on the .NET side so dependencies stay easy to manage.
* **Async/await**: Use asynchronous calls for all I/O work to keep the app responsive.
* **Modular design**: Build features as self-contained modules that can be discovered automatically.
* **Interface-based services**: Define services with interfaces to make testing and swapping implementations easier.

See [coding-standard.md](coding-standard.md) for the full set of conventions, including mnemo-web's own TypeScript and React standards.

## Contributing

Contributions are welcome! Please read the [coding standards](coding-standard.md) before submitting pull requests.

If you're new to the project, look for issues labeled `good first issue`.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

> "Education is not the learning of facts, but the training of the mind to think."  
> Albert Einstein
