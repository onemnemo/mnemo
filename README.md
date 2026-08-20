<p align="center">
  <img width="600" alt="Mnemo" src="https://github.com/user-attachments/assets/7e52d41a-f3d9-42fe-ada7-d44c6b3da574" />
</p>

<div align="center">

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Status](https://img.shields.io/badge/status-Beta-blue.svg)](https://github.com/onemnemo/mnemo/releases)

**Free. Open source. Local first. Built by learners, for learners.**

[Download](https://github.com/onemnemo/mnemo/releases/latest) · [Documentation](https://www.mnemo.one/docs) · [Contributing](CONTRIBUTING.md)

</div>

## What is Mnemo?

Mnemo is a study app for **notes, flashcards, mindmaps and progress tracking**, built to keep everything in one place without giving up ownership of your work.

Your data lives on your own machine. There is no account requirement, no tracking, and nothing is sent over the network unless you explicitly enable a feature that needs it.

> **No ads. No accounts. No tracking. Local by default.**

Mnemo combines a React and TypeScript interface with a local .NET backend and runs as a desktop application through PhotinoX.

## Screenshots

<table>
<tr>
<td width="50%">

**Notes Editor**

![Notes editor](https://www.mnemo.one/screenshots/notes.png)

</td>
<td width="50%">

**Flashcards**

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

## Built for studying, not just storing things

Mnemo is meant to replace the pile of separate tools that tends to grow around studying.

**Notes** use a block editor built for long documents, with rich text, math, code, images, callouts, columns, page links, tabs, find and replace, and a draggable note tree. Notes export to Markdown, portable `.mnemo` packages, or PDF through a bundled Typst compiler with live preview.

**Flashcards** support classic and cloze cards, decks and folders, and review scheduling through FSRS. A separate self-graded test mode lets you test yourself without changing the review schedule. Decks can move through Anki packages, CSV and `.mnemo`.

**Mindmaps** run on an infinite canvas built specifically for Mnemo. Maps support nodes, shapes, text, images, frames, multiple layout algorithms, custom edges, reusable styles and a minimap. Export to PNG, SVG or a Markdown outline.

**Overview** gives you a configurable study dashboard with widgets for reviews, streaks, activity, forecasts, retention, leeches, goals, recent notes and more.

Across the app you also get light and dark themes, remappable shortcuts, a command palette, notification history, configurable behaviour and interface support for English, German, Spanish, Japanese and Norwegian Bokmål.

## Your work stays portable

Mnemo does not try to trap your material inside the application.

* Notes export to Markdown and PDF
* Flashcards import and export through Anki packages and CSV
* Mindmaps export to PNG, SVG and Markdown
* `.mnemo` packages preserve Mnemo content for moving or backing up complete collections

The application database and files stay in your local application data directory.

## Project status

Mnemo is currently **0.8.0-beta**.

**Windows** is the only platform with a tested packaged release today. It is available as a normal `.exe` installer or portable zip.

**macOS and Linux** compile, but neither has been packaged and tested end to end yet, so downloads are not published for them.

Windows builds are also **not code signed yet**, which means SmartScreen will warn when opening Mnemo for the first time. Releases are built from the tagged source through public GitHub Actions workflows and published with checksums, keeping the build process transparent and verifiable.

Mnemo is stable in daily use, but it is still pre-release software. Keep backups of anything important while the project is in beta.

## Install

### Windows

1. [Download the latest release](https://github.com/onemnemo/mnemo/releases/latest).
2. Run the installer, or unpack the portable zip.
3. If Windows SmartScreen appears, choose **More info** and then **Run anyway**.

For a full walkthrough, see the [installation documentation](https://www.mnemo.one/docs/students/installing).

macOS and Linux packages are planned, but are not published yet.

## Soma

Mnemo includes an optional assistant called **Soma**.

Soma is off by default and disappears from the interface while disabled. Today it supports chat through your own OpenRouter key, along with an experimental agent mode that can work with notes, mindmaps and settings.

Local model support, deeper integration into the study modules, permissions, previews and reliable undo are still under development.

**Mnemo is a study app that can use a model, not a chat app with study features attached. This is an important philosophy for the team to avoid becoming AI tangled slop.**

## Roadmap

Roughly what we want to work on next:

* **Local models:** Get local models working properly
* **Soma integration:** Bring Soma into the editor and study tools, with permissions, previews, and undo
* **Search:** Full-text search across notes and flashcards
* **Document reading:** PDF and slide reading, including turning highlights into cards
* **Practice options:** More ways to practise, including study games
* **Syncing:** Optional sync, both self-hosted and hosted
* **Extensions:** Extensions for things like modules, themes, and languages
* **Platform support:** Proper macOS and Linux releases

Local use will remain the default. Online features are intended to stay optional.

## Architecture

Mnemo ships a web frontend and .NET backend together as one desktop application.

* **`mnemo-web`** contains the React, TypeScript and Tailwind interface.
* **`Mnemo.Host`** opens the PhotinoX window, runs the loopback-only local API and serves the frontend.
* **`Mnemo.Core`** contains shared models, interfaces and contracts.
* **`Mnemo.Infrastructure`** contains implementations for storage, notes, flashcards, mindmaps, import/export and the assistant stack.

The backend uses .NET 10, ASP.NET Core and SQLite. The frontend uses React 19, TypeScript and Vite, with ProseMirror for editing, KaTeX for math and Typst for PDF export.

## Build from source

You will need:

* .NET 10 SDK
* Node.js 22 or later
* npm

Install the frontend dependencies:

```bash
cd mnemo-web
npm install
cd ..
```

Restore the bundled Typst binary:

```powershell
./scripts/restore-typst.ps1
```

On Linux or macOS:

```bash
./scripts/restore-typst.sh
```

For development, start the host first:

```bash
dotnet run --project Mnemo.Host -- --dev
```

Then start the frontend in another terminal:

```bash
cd mnemo-web
npm run dev
```

The host and Vite communicate through a per-launch development handshake, so the host needs to start first.

On Windows, `dev.bat` starts both processes for you, each in its own terminal, and installs the web dependencies on first run.

For development workflow, testing and contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Contributions are welcome.

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [coding-standard.md](coding-standard.md) before opening a pull request. Issues labelled `good first issue` are a good place to start.

Please also see:

* [Code of Conduct](CODE_OF_CONDUCT.md)
* [Security Policy](SECURITY.md)
* [Documentation](https://www.mnemo.one/docs)

## License

Mnemo is licensed under the **Apache License 2.0**.

See [LICENSE](LICENSE) for the full license, [NOTICE](NOTICE) for attribution and [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES) for bundled dependencies.

The Mnemo name, logo and visual identity are covered separately by [BRAND.md](BRAND.md).
