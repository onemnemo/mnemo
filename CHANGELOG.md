# Changelog

All notable changes to Mnemo are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Mnemo uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Every released version gets a `## <version>` heading spelled exactly as the tag is, minus its
leading `v`. The release workflow copies that section verbatim into the update prompt shown
inside the app, so a heading that does not match the tag ships a release with no notes at all.

## Unreleased

### Added

- macOS and Linux packages. Both are new and neither has been through a real install yet, so
  they go out on the nightly channel first.
- Launch at startup now works on macOS and Linux. It previously toggled on those platforms
  and silently did nothing.
- Startup failures now report themselves on macOS and Linux instead of the window simply
  never appearing.
- The app is served under a content security policy.

### Changed

- The window is now sized against the display on macOS and Linux, so it can no longer open
  larger than the screen it is on.
- Log files are capped in size, and files older than two weeks are removed at startup.
  The logs folder previously grew for as long as the app was installed.

### Fixed

- A stray second copy of the app is no longer left in macOS and Linux installs, where
  launching it started a broken instance.
- The Typst binary is now marked executable when it is restored on macOS and Linux, so PDF
  export works in packages built there.
- A setting that could not be saved now reports the failure. It previously looked saved for
  the rest of the session and was gone at the next launch, which was most noticeable with
  the AI API key.
- A crash after startup now shows a message saying where the details were written, rather
  than the window disappearing with nothing said.
- Links in chat now open in the browser the same way links elsewhere in the app do.
- Opening a library written by a newer version of Mnemo is now refused with an explanation,
  instead of being read through older assumptions.
