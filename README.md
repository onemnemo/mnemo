<p align="center">
  <img width="600" alt="Mnemo" src="https://github.com/user-attachments/assets/7e52d41a-f3d9-42fe-ada7-d44c6b3da574" />
</p>

<div align="center">

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Status](https://img.shields.io/badge/status-Beta-blue.svg)](https://github.com/onemnemo/mnemo/releases)

**Free. Open source. Local first. Built by learners, for learners.**

[Downloads](https://github.com/onemnemo/mnemo/releases) · [Documentation](https://www.mnemo.one/docs) · [Contributing](CONTRIBUTING.md)

</div>

## What is Mnemo?

Mnemo is a desktop study app for **notes, flashcards, mind maps and progress tracking**. It
keeps those tools together without taking ownership of your work.

Your notes and study data live on your machine. Mnemo has no accounts and no tracking. By
default, it makes a request to GitHub Releases when it starts to check for updates. You can
turn this off in **Settings > Updates**. Mnemo sends no account or analytics data with that
request.

> **No ads. No accounts. No tracking. Local by default.**

Mnemo combines a React and TypeScript interface with a local .NET backend. PhotinoX hosts the
interface in the operating system's native web view.

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

**Mind map**

![Mind map](https://www.mnemo.one/screenshots/mindmaps.png)

</td>
</tr>
</table>

## Built for studying

**Notes** use a block editor built for long documents, with rich text, math, code, images,
callouts, columns, page links, tabs, find and replace, and a draggable note tree. Notes export
to Markdown, portable `.mnemo` packages, or PDF through a bundled Typst compiler.

**Flashcards** support classic and cloze cards, decks and folders, and review scheduling
through FSRS. A separate self-graded test mode lets you test yourself without changing the
review schedule. Decks can move through Anki packages, CSV and `.mnemo` packages.

**Mind maps** run on an infinite canvas built for Mnemo. Maps support nodes, shapes, text,
images, frames, several layout algorithms, custom edges, reusable styles and a minimap. You can
export a map to PNG, SVG or a Markdown outline.

**Overview** is a configurable study dashboard. Its widgets cover activity, recent notes and
decks, study goals, usage, memory and testing.

Across the app you also get light and dark themes, remappable shortcuts, global search,
notification history and interface support for English, German, Spanish, Japanese and
Norwegian Bokmål.

## Your work stays portable

Mnemo does not try to trap your material inside the application.

* Notes export to Markdown, PDF and `.mnemo` packages
* Flashcards import and export through Anki packages, CSV and `.mnemo` packages
* Mind maps export to PNG, SVG, Markdown and `.mnemo` packages
* The application database and managed files stay in your local application data directory

## Project status

Mnemo is currently in the **0.8.0 beta**.

| Platform | Build | Status |
| --- | --- | --- |
| Windows 10 and 11, x64 | Installer and portable zip | Used daily, unsigned |
| macOS, Apple silicon | Installer package and portable archive | First preview, unsigned and not notarized |
| Linux, x64 | AppImage and portable archive | First preview |

Windows has had months of daily use. The macOS and Linux packages are new and still need wider
hardware coverage, so treat them as previews and report platform-specific problems.

The builds are not code signed yet. Windows SmartScreen and macOS Gatekeeper will therefore warn
before the first run. Tagged releases are built from public source through GitHub Actions, and
the 0.8 release workflow publishes a `SHA256SUMS.txt` file for its installers and portable
archives.

This is pre-release software. Keep a current backup of anything important.

## Install

Choose the newest 0.8 beta on the [releases page](https://github.com/onemnemo/mnemo/releases).

### Upgrading from 0.6.x

An existing 0.6.x installation will not offer the 0.8 update because the package identity
changed with the rebuild. Download and run the 0.8 installer directly. Your notes, flashcards,
mind maps and settings stay in the same data directory and are migrated when 0.8 first opens.
Close Mnemo and make a backup of that directory before upgrading.

### Windows

1. Download the Windows x64 installer, or download and unpack the portable zip.
2. Run Mnemo. If SmartScreen appears, choose **More info**, then **Run anyway**.

Mnemo requires the [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/consumer/).
It is normally already present on Windows 11 and current Windows 10 installations. Windows
Server, LTSC and stripped Windows images may need it installed separately.

### macOS

The current macOS build supports Apple silicon. Download the installer package and try to open
it once. If macOS blocks it, open **System Settings > Privacy & Security**, scroll to Security,
choose **Open Anyway**, then confirm **Open**. This adds an exception for that build.

The package is unsigned and not notarized. Confirm that its checksum matches the release before
using the Gatekeeper override.

### Linux

The current Linux build supports x64 and targets Ubuntu 22.04 or newer. Download the AppImage,
make it executable, then run it:

```bash
chmod +x Mnemo.Desktop.V2-linux-x64-*.AppImage
./Mnemo.Desktop.V2-linux-x64-*.AppImage
```

On Ubuntu 24.04, install the native runtime packages first:

```bash
sudo apt install libfuse2t64 libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0 libgtk-3-0t64 libnotify4
```

Other distributions need equivalent GTK 3, WebKitGTK 4.1, JavaScriptCoreGTK, libnotify and
FUSE 2 packages.

## Backups

Open **Settings > Support > Open data folder** to find the complete Mnemo data directory. Close
Mnemo, then copy that directory somewhere safe. Restoring that copy restores the application as
a whole.

A `.mnemo` export covers the notes, decks or maps selected for that export. It does not include
the trash, Overview layout or all application settings. Items in the trash are permanently
removed after 30 days.

## Uninstall

An installed copy can be removed through the operating system. A portable copy can be removed by
deleting its extracted folder. Mnemo leaves your data directory in place so uninstalling or
upgrading does not erase your work. Delete that directory yourself only when you want to remove
all Mnemo data.

Turn off **Launch at startup** before uninstalling. If Mnemo was removed first, clear the leftover
startup entry named `Mnemo` from the Windows Startup Apps list, the macOS login items, or your
Linux desktop's autostart settings.

## Roadmap

Mnemo is in beta. The 0.8.x releases focus on fixes and platform coverage. Version 0.9 brings
search across notes and the rebuilt assistant, which runs locally. Version 1.0 means signed
builds, Windows, macOS and Linux validated on real hardware, and an assistant available to
everyone.

Document reading, more ways to practise, optional sync and extensions follow. A full roadmap
will be published soon.

## Architecture

Mnemo ships a web frontend and .NET backend together as one desktop application.

* **`mnemo-web`** contains the React, TypeScript and Tailwind interface.
* **`Mnemo.Host`** opens the PhotinoX window, runs the loopback-only local API and serves the frontend.
* **`Mnemo.Core`** contains shared models, interfaces and contracts.
* **`Mnemo.Infrastructure`** contains storage, notes, flashcards, mind maps, import, export and assistant implementations.

The backend uses .NET 10, ASP.NET Core and SQLite. The frontend uses React 19, TypeScript and
Vite, with ProseMirror for editing, KaTeX for math and Typst for PDF export.

## Build from source

You will need:

* .NET 10 SDK
* Node.js 24
* npm

Install the frontend dependencies from the lockfile:

```bash
cd mnemo-web
npm ci
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

The host and Vite communicate through a per-launch development handshake, so the host needs to
start first.

On Windows, `dev.bat` starts both processes, each in its own terminal, and installs the web
dependencies on first run.

For development workflow, testing and contribution guidelines, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Contributions are welcome.

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [coding-standard.md](coding-standard.md) before
opening a pull request. Issues labelled `good first issue` are a good place to start.

Please also see:

* [Code of Conduct](CODE_OF_CONDUCT.md)
* [Security Policy](SECURITY.md)
* [Documentation](https://www.mnemo.one/docs)

## License

Mnemo is licensed under the **Apache License 2.0**.

See [LICENSE](LICENSE) for the full license, [NOTICE](NOTICE) for attribution and
[THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES) for bundled dependencies.

The Mnemo name, logo and visual identity are covered separately by [BRAND.md](BRAND.md).
