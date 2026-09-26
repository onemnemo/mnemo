# Changelog

All notable changes to Mnemo are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Mnemo uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Every finished release gets a `## <version>` heading spelled exactly as the tag is, minus its
leading `v`. The release workflow copies that section into the release notes. A release
candidate without its own section uses the matching finished release section, while nightly
builds without a section receive a short generated fallback.

## 0.8.0

Mnemo 0.8.0 is a rebuild. The old desktop shell is gone. Mnemo now ships a web interface inside a native window with a local .NET backend on Windows, macOS and Linux. Windows has had months of daily use. The macOS and Linux packages are previews with far less use than Windows, so expect rough edges and keep backups of anything important.

### Upgrading from 0.6.x

The update feed identity changed with the rebuild, so an existing 0.6.x installation is never offered this version. Download and install 0.8.0 directly. Notes, flashcards and mind maps stay in the same local data folder and are migrated on first launch. Nothing needs exporting first, but close Mnemo and back up that folder before upgrading.

### Added

- **Notes.** The slash menu can open partway through a line, keeping the surrounding text when you choose a command. Type a backslash at a word boundary to find symbols by name, including Greek letters, operators, arrows and fractions.
- **Notes.** Spell checking now includes the note title.
- **Flashcards.** Selected cards can be given a new due date, started over, or moved within a deck's new-card queue from the deck and card browser pages. Rescheduling does not add a review, and starting over keeps the review history.
- **Mind maps.** Find inside an open map with Ctrl+F, move between matching labels with Enter and Shift+Enter, and jump to each match at a readable zoom. Searches also match the beginnings of words.
- **Mind maps.** Text and task nodes, shape labels and captions support rich text, inline equations and symbols through the same formatting controls as notes. Formatting is preserved in map exports.
- **Mind maps.** Draw lines and arrows, move their ends and bends, attach ends to elements, and rotate closed shapes. Line caps, thickness and colour can be changed across a selection, with keyboard controls for line and rotation handles.

- **Notes.** The note editor is now organized into blocks such as paragraphs, headings, lists, quotes and dividers. You can create them with markdown style shortcuts as you type, convert one type into another, drag them to reorder using each block's own handle, and undo or redo any change.
- **Notes.** Blocks can be dragged into a two column layout: drop one into either column, move it between the columns or reorder it within one, and drag it back out onto the page.
- **Notes.** Added block level selection: drag in the note's margin to select a run of blocks, or press Ctrl+A to select the current block and press it again to select the whole note. A selection can be dragged to reorder it, and dragging selected text moves it across blocks, including inside a two column layout.
- **Notes.** Added a slash menu: type a slash to insert a block such as a heading, list, table, image, equation, callout or two column layout, with icons and descriptions to help you find the right one. It only opens for a slash you just typed, and is reachable from the keyboard.
- **Notes.** Added a floating formatting toolbar that appears near a text selection, for bold, italic, links, inline code, and text or highlight colour, with a redesigned colour picker. It is fully reachable from the keyboard, including its link and inline code buttons.
- **Notes.** Added copy, cut and paste for blocks. Content copied from Mnemo or pasted as plain text, HTML or a Markdown table becomes proper blocks. Nested lists pasted from other apps keep their structure, block selections are replaced exactly, and referenced images are copied into the destination note.
- **Notes.** Addresses and links you type or paste turn into links as you go.
- **Notes.** Added find and replace inside a note, bound to Ctrl+F.
- **Notes.** Added equations: an inline or block equation can be typed with a live preview and is rendered with proper math typesetting, and there is a keyboard shortcut to insert one, without deleting the text around it.
- **Notes.** Added a table block, with header rows and columns you can set independently, copying and pasting a whole grid of cells, and a menu reachable with the keyboard's context menu key.
- **Notes.** Added a callout block with a customizable icon, a two column layout block with a draggable divider, and a code block with syntax highlighting.
- **Notes.** Added image blocks: upload, paste or drag a picture into a note, with a preview of where it will land before you drop it, including onto an empty image block, then resize, align, crop and caption it, or use its hover menu to replace, copy or download it. Clicking a picture selects its block, and dragging it reorders it like any other block.
- **Notes.** Notes now have a title you can edit in place at the top of the note, an emoji or custom icon, a cover image you can upload and reposition, and tags. The header's own actions, such as duplicate and export, are gathered into a single menu, and the breadcrumb sits in the title bar.
- **Notes.** List items can now be nested, using Tab and Shift+Tab to change indent level, and nesting is preserved when exporting to markdown or PDF. Checklist items are real, clickable checkboxes.
- **Notes.** Added a tree sidebar for browsing notes and folders, with a breadcrumb, word count, save status, and collapsible sections. Right click a note or folder for rename and other actions, and the note's outline is available from a popover in the top bar. The app remembers your last open note and which folders were collapsed.
- **Notes.** Added tabs, so multiple notes can be open at once. A note can be duplicated into a new tab, tabs have a right click menu, and can be closed with the middle mouse button. Alt and click, or Alt and Enter, on a note in the sidebar opens it in a side peek instead, previewing it without leaving your current tab.
- **Notes.** Added PDF export for notes, rendered so that fonts and layout match the editor, including in code blocks, with a dialog to choose export options and where the file is saved.
- **Notes.** Added note import and export. Imported Markdown lands in the folder you are viewing. Replacing existing content asks for confirmation and explains whether the replaced note stays recoverable in the trash.
- **Notes.** Added a page reference block, inserted by typing a slash and the word page, that links to another note or creates one, shown as a row with an icon and title in the note's outline.
- **Notes.** Notes are now spell checked as you type, with flagged words underlined and a correction card when you click one. You can choose which languages a note is checked in from its menu, and the underlines stay in sync even during rapid edits or undo.
- **Notes.** Clicking a link opens a card to open, edit or remove it. Editing changes the text and address together, and holding a modifier while clicking opens the link directly.
- **Notes.** Notes autosave as you type, with a status indicator showing whether the note is saved. Ctrl+S saves immediately, closing the window waits for the save to finish rather than just the confirmation prompt, and turning off autosave in settings now actually stops it from saving in the background.
- **Flashcards.** You can now import an existing Anki package into a collection of decks, including basic and cloze cards, images, and the deck folder structure, with a preview of what will be imported before you commit to it. Packages written by current versions of Anki are supported, not just older ones, and imported cards keep the review history and schedule they already had instead of starting over.
- **Flashcards.** Importing from Anki now keeps how well each card is known, and exporting carries its due date, study phase, interval and memory, so a studied deck stays studied in either app.
- **Flashcards.** Exporting to Anki now preserves your deck folder structure, so the trip out and back in keeps your library organized the way you had it.
- **Flashcards.** Cards can now be generated from a single piece of underlying material that you edit once, which makes reverse cards, multi-part cloze paragraphs, and vocabulary entries with an example possible. Editing the material regenerates its cards while keeping the study progress of any that still exist, and the editor shows how many cards a save will produce as you type.
- **Flashcards.** Card text keeps its formatting everywhere it is read, including browse, study, test and preview surfaces.
- **Flashcards.** A preset can hold a card's sibling cards back until the next study day once one of them has been answered, and can automatically tag or suspend a card once it has been forgotten too many times.
- **Flashcards.** The study day can roll over at whatever local hour you choose instead of always at midnight, and interval calculations, daily caps, the review forecast, and retention trends all follow that same boundary.
- **Flashcards.** The review settings dialog can fit the scheduler's weights to your own collection's review history and report how much better they predict your recall, instead of only offering the built in defaults.
- **Flashcards.** A new collection-wide card browser lets you search and filter cards across every deck from one page, with a quick read-only peek at a card without leaving the table, and the deck page can show a forecast of how many cards will come due on each of the next several days.
- **Flashcards.** After a test session, you can retake just the cards you missed instead of running the whole test again.
- **Flashcards.** Decks can carry an emoji icon, and the deck and card browser tables can be filtered by card type and by how many times a card has been forgotten.
- **Flashcards.** Library folders have a right-click menu with options to expand or collapse the folder, and you can drag decks and folders to reorganize your library, including dropping onto empty space to move something to the top level.
- **Mind maps.** Mind maps support frames: titled containers that group nodes so they move and get rearranged together. A node can be dragged into a frame to join it, a marquee selection can be turned directly into a frame, and any element can be resized by dragging a corner.
- **Mind maps.** A connect tool draws a link edge by dragging from one element to another, connecting any two elements on the map rather than only a parent to its child. Link edges can be selected, restyled, or deleted like any other element, and can use arrow or dot caps, dashed, dotted, or double lines, curved, straight, or right angled routing, and a label on the line, which a double click on the line opens for editing.
- **Mind maps.** Nodes can hold more than plain text: tasks with a clickable checkbox, code shown in monospace with a language label, and link, note, or flashcard deck nodes that show the title of whatever they point to, with a due count for a deck. A node can be converted from one of these kinds to another without retyping its content, and images can be placed on the canvas by dropping, pasting, a keyboard shortcut, or a dock button.
- **Mind maps.** Node and branch styling can be saved as a personal template alongside a set of built in ones, and applied again later, including how many levels of a branch it reaches. A style panel controls the whole map's look, a docked inspector offers custom colors, an edge's color and weight can be set individually or applied to a whole branch at once, and a starting style can be chosen when a map is created.
- **Mind maps.** A shape tool adds flowchart shapes and a free form blob to the canvas, with a picker that opens by holding the tool down. Holding Q opens a radial quick menu of actions at the pointer, where a flick and release performs an action without a separate click.
- **Mind maps.** A map can be arranged automatically with a choice of layout algorithms from the editor's top bar, loose elements can be lined up and evenly spaced, and a node can be pinned so arranging leaves it in place, shown with a small badge.
- **Mind maps.** A minimap in the corner shows the whole map and jumps the camera there when clicked.
- **Mind maps.** A mind map can be exported as a PNG or SVG image, or as a nested outline, and whole maps can be bundled into a file, with their folders, images, and style templates, to move them between libraries. An integrity check can find references to notes, decks, or images that no longer exist.
- **Mind maps.** The mind map library has folders that can be sorted and searched, with drill in navigation, due badges, and a right click menu for common actions.
- **Mind maps.** A branch can be copied and pasted back down elsewhere, including into a different map.
- **Mind maps.** Typing directly into a node grows the map: Enter adds a sibling, Tab adds a child, and Shift+Tab moves a node back out from under its parent.
- **Overview and settings.** The Overview page is now a customizable dashboard. Edit mode lets you add, remove, move, resize and configure seven widgets. The Study Goals widget takes its own card, session and minute targets, and one widget failing no longer takes down the whole board.
- **Overview and settings.** Settings has a Trash page. Deleting a note, folder, mindmap, deck, card, or piece of material now shows an undo toast instead of a confirmation dialog, and everything deleted collects on this page until its retention period runs out, with search, filtering by kind, and restore or permanent delete for each item.
- **Overview and settings.** Settings has a Keyboard page listing every action and its shortcut. You can search it, click a shortcut to record a new one, revert a change back to its default, and see a warning when two actions share the same keys.
- **Overview and settings.** Support rows open the app's log and data folders in the system file manager.
- **Overview and settings.** Storage settings can create one complete backup file with your notes, flashcards, mind maps, conversations, settings, trash, and managed files, then validate and restore it through a controlled restart while keeping a recovery copy of the previous data.
- **Overview and settings.** First run now walks through a proper setup: a welcome screen, then your name and picture, appearance, and language, with a closing screen and skip always one click away. Your picture can be your own upload, from the same picker used later in Settings.
- **Overview and settings.** Profile pictures are optional. Without one, your initials use a colour you choose in Settings.
- **Overview and settings.** Spell check can use several languages at once. Add languages in the order you want suggestions prioritized, and a word is only flagged when every active language disagrees with it. English and Spanish dictionaries are included, and other languages are listed with the reason they cannot be used yet.
- **Overview and settings.** A misspelled word's menu can add it to your personal dictionary or ignore it for just the current note, from a searchable list with one click removal, and either action can be undone. Personal dictionary entries and a note's language settings and ignored words are also carried along when you export or import that note.
- **App and platform.** The app can check for updates automatically, show when one is ready, and download and apply it. Stable, Beta and Nightly release channels are available.
- **App and platform.** The first launch of a beta build shows a short notice saying so, with a button that makes the same one-file backup as Settings and a link to the issue form. It appears once per beta version.
- **App and platform.** Deleting a note, mindmap, flashcard deck, or card now moves it to a trash for thirty days instead of erasing it immediately, and restoring a deck or folder brings back everything that was inside it.
- **App and platform.** Exporting now lets you choose where to save the file, and confirms where it ended up afterward.
- **App and platform.** Importing from Anki now carries over review history, math notation, and cloze deletion cards, instead of just the plain card text.
- **App and platform.** The app now asks for confirmation before closing the window.
- **App and platform.** Added a side peek panel that shows a note or flashcard beside the current page without navigating away.
- **App and platform.** The app now warns once if it notices this install is sharing its data with an older, separately installed copy of Mnemo.
- **App and platform.** Added a global search palette for quickly finding notes, cards, and other content from anywhere in the app.
- **App and platform.** The macOS and Linux packages now run on the new shell. They are preview builds and have less hardware coverage than Windows. On macOS the window has the standard app menu, and Cmd+Q, or Quit from the Dock, waits for unsaved work before quitting.
- **App and platform.** Opening Mnemo while it is already running brings the open window forward instead of starting a second copy on the same data.
- **App and platform.** Launch at startup now works on macOS and Linux. It previously toggled on those platforms and silently did nothing.
- **App and platform.** Startup failures now report themselves on macOS and Linux instead of the window simply never appearing.
- **App and platform.** The app is served under a content security policy.

### Changed

- **Mind maps.** Existing math nodes become text nodes containing an inline equation. The tool dock and shape picker have been redesigned.


- **Flashcards.** The spaced-repetition scheduler has been upgraded from FSRS-5 to FSRS-6, which more accurately predicts how likely you are to remember a card at review time.
- **Flashcards.** Deck, folder, card, and card type names and text now have a maximum length and are rejected if they exceed it, instead of being accepted and then breaking the library and browse views.
- **Flashcards.** The card type manager and the material editor now load only when you open them, so the flashcards area loads faster.
- **Mind maps.** Zooming now follows the mouse wheel, and panning works with a regular drag, without needing the middle mouse button.
- **Mind maps.** Large mind maps are noticeably faster to work with. Panning, zooming, and searching now only touch what changed instead of the whole map, and deleting a branch happens in a single pass instead of one step per node.
- **Mind maps.** Images removed from a mind map's canvas are now cleaned up from storage automatically, instead of being kept indefinitely.
- **Overview and settings.** The app's overall look was redesigned: a new sidebar and topbar layout, updated icons, a new typeface, and refreshed light and dark color themes throughout.
- **Overview and settings.** Context menus and other flyout menus were restyled with a more compact, dark themed look and monospace shortcut hints.
- **Overview and settings.** Settings was reorganized around the pages people actually use, with clearer section headings, a comfortable width for each row so a label and its control read as one thing, and a category list that scrolls on its own instead of dragging the page around with it. Appearance now shows a live miniature preview of each theme, plus the option to match your system's light or dark setting automatically.
- **Overview and settings.** Spelling settings moved from Notes to Application settings as a single page, spell check itself is now one switch instead of separate browser and Mnemo controls, and language names throughout the app (settings, the language picker, and a note's language menu) are now shown in your own language instead of always in English.
- **Soma.** The unfinished assistant is hidden throughout the beta while it is prepared for general use.
- **App and platform.** The app now draws its own window frame and title bar with rounded corners, on macOS too, instead of using the operating system's default, and dragging the title bar to move the window now works correctly on Linux.
- **App and platform.** Theme and language choices are now saved through the app's own settings instead of only the browser, so they survive things like clearing browser data.
- **App and platform.** The updater now automatically follows whichever channel, stable or nightly, you actually installed, instead of needing it set separately.
- **App and platform.** Import and export now open in a single dialog instead of a separate overlay screen.
- **App and platform.** The app starts faster. It no longer waits on the network's proxy discovery before showing the first screen, and pages you have not visited yet load in the background instead of upfront.
- **App and platform.** The window is now sized against the display on macOS and Linux, so it can no longer open larger than the screen it is on.
- **App and platform.** Log files are capped in size, and files older than two weeks are removed at startup. The logs folder previously grew for as long as the app was installed.

### Fixed

- **Notes.** Pasting nested lists into tables keeps their content, Markdown round trips preserve soft breaks, and empty equation chips no longer export as math fences. Older notes with numeric fields stored as text remain readable.
- **Notes.** Paste progress stays below dialogs and notifications instead of covering them.
- **Flashcards.** Anki imports preserve mature review state more accurately and read cloze text from the field named by the card template. CSV imports detect the file's delimiter and explain the import action in the preview. Image references containing brackets are read correctly.
- **Flashcards.** Closing an enlarged image no longer reveals the answer beneath it, and enlarged images use consistent sizing.
- **Flashcards.** Edits made during a study session survive later grades, including leech handling, and appear when the card comes around again. Grading a rescheduled card uses its current saved schedule.
- **Flashcards.** Restoring review state leaves trashed cards and material untouched, and importing a package rejects unusable scheduler weights.
- **Mind maps.** Edited labels stay visible while the camera moves, clicks inside a label place the caret, and typed line breaks survive rendering. Clicking a formatted link on the canvas does not navigate away from the map.
- **Mind maps.** Undoing a deletion restores the original element order, abandoning a blank new node does not consume undo steps, and a late save response cannot overwrite a newer reload. Root colours now match the chosen colour, and empty line captions stay hidden.
- **App and platform.** Backups can include more than a few thousand files, and a busy database produces an explanation when a backup cannot start. Unused assets are cleaned up even when the profile has no saved notes.
- **App and platform.** Portable update checks only offer releases with downloads for the current platform.
- **App and platform.** Dialogs are protected from accidental dismissal, flashcard loading dialogs keep their eventual size, and a page failure leaves the surrounding app available. Side peek panels keep their minimum width beside a wide dock and no longer reload the library just to read a title.
- **App and platform.** Keyboard settings reject shortcuts reserved by the window, and exported filenames handle more Windows device-name variants safely.

- **Notes.** Fixed several ways a note's data could be silently lost or corrupted. Opening a note with a block type or content this version does not recognize now keeps it intact and refuses to open it for editing, with an explanation, instead of silently flattening or discarding parts of it, and any images referenced only by that content are no longer deleted as unused. A note with no blocks at all now opens normally instead of being treated as broken. Renaming, tagging or moving a note that is open for editing could previously stop it from saving further changes, or let a stale copy overwrite a save made around the same time, and both are now fixed. An AI assisted edit to a note is now checked for conflicts the same way a manual edit is, instead of being able to silently overwrite one, and deleting a note that cannot actually be deleted, such as one already in the trash, now reports the failure instead of a false success.
- **Notes.** Fixed newly typed text sometimes remaining invisible until the next scroll or edit, on Mac and Linux, where the app uses a WebKit based browser engine.
- **Notes.** Fixed typing near an equation, or typing with an IME as used for languages such as Japanese, Chinese or Korean, sometimes destroying nearby content in a note.
- **Notes.** Fixed performance problems that could make the app pause: opening a large note, loading the notes sidebar, exporting to PDF, and pasting a large amount of content are all faster now and no longer freeze the editor.
- **Notes.** Fixed PDF exports to match the editor much more closely: inline equations no longer break their sentence, numbered lists count the way the editor does, table cells are no longer printed twice, quotes and callouts get enough room, spacing and line breaks match the editor, special characters and scripts inside equations are typeset correctly, and the export preview is sharp instead of blurry.
- **Notes.** Fixed numerous table editing bugs: cells could tear apart on Enter, Backspace, paste or block selection, the caret could jump illogically between rows, resize handles and rails could be hard to reach, flyout menus could be unresponsive, and a drag gesture could get stuck partway through.
- **Notes.** Fixed keyboard and selection bugs: Backspace and Delete could jump across more text than intended, Enter, Tab and arrow keys behaved inconsistently at the edges of a block, dragging selected text could trigger the browser's own drag instead of the app's, and a caret now appears beside blocks with no editable text, such as an image, instead of letting stray typing land inside them.
- **Notes.** Right clicking inside a note, on an image, or on a text selection now opens the app's own menu with actions such as copy and paste, instead of the browser's default menu or nothing at all. Right clicking a picture no longer clears your current selection.
- **Notes.** Fixed several rough edges in the editor: creating a note now opens it directly instead of an empty, non working card, opening a note focuses it immediately, floating toolbars and the equation editor stay anchored to what they are attached to instead of drifting, read only notes no longer show editing controls that would not work anyway, the note no longer jumps the first time you scroll it, the block gutter fades in instead of snapping into view, and animations respect the reduced motion setting.
- **Notes.** Invisible control characters, typed or pasted, are no longer saved into notes and mind map labels.
- **Flashcards.** Anki import is more reliable in several ways: the import preview shows the correct number of records in a CSV file, a cloze deletion that wraps onto a new line is read correctly, an imported cloze note now generates one card per deletion with each showing its own answer instead of every card showing the first deletion's answer, a note with several templates (such as a reversed card) creates the correct distinct cards instead of two copies of the same one, you are no longer asked to resolve a naming collision for imports where the answer cannot change anything, and a note that references audio, which the app cannot play, now says so instead of showing the raw file reference as text.
- **Flashcards.** Card images are handled more carefully around import, export, and backup: they are stored as proper files instead of temporary ones, included when exporting to Anki or creating a backup instead of being left out, and no longer destroyed when a replacing import fails partway through.
- **Flashcards.** Review scheduling is more reliable in several edge cases that previously misdated or miscounted a card's next review: learning and relearning steps now return at the time their own step specifies, a card that lapsed and then sat overdue can no longer come back more stable than it was before the lapse, the daily review cap no longer counts learning steps or a new card's first look against your due-card budget, starting a session twice in quick succession can no longer create two overlapping sessions, and the settings dialog now shows the scheduling algorithm actually in effect.
- **Flashcards.** Several edge cases where a deck's underlying material could be lost or left orphaned, such as importing an older collection, moving a card between decks, renaming a deck, or deleting a deck that still had material elsewhere, are now handled correctly, and deleting a card or deck also cleans up its attachment files instead of leaving them behind.
- **Flashcards.** Editing material in a way that would delete cards or review history now asks for confirmation. Cards removed by a card type edit move to the trash and can be restored. Closing the card editor with unsaved changes warns before discarding them, and undoing a leech no longer undoes an unrelated edit.
- **Flashcards.** Revealing a cloze card's answer now actually shows it, line breaks in card text are preserved during study and test sessions instead of being collapsed onto one line, moving a card between decks no longer loses its content, and moving a card now refreshes every open deck view instead of just the one it moved from or to.
- **Flashcards.** You can now change an existing card's type, and renaming a field on a card type updates every template that names it instead of leaving it pointing at a field that no longer exists.
- **Flashcards.** A collection with one card holding corrupted attachment data now still opens instead of failing to load entirely, and uploaded card images are validated by their actual file contents rather than trusted by file extension.
- **Flashcards.** Several small bugs in the deck and card list views are fixed: the deck row's Export menu item now works, deck statistics no longer include a deleted deck's history, saving a card no longer undoes a deck move you just made, and selecting several cards is preserved when you act on one of them.
- **Flashcards.** A deck's retention percentage no longer shows a misleadingly high number before you have studied it enough. It stays blank with an explanatory tooltip until there is enough review history, and daily study statistics can no longer show a negative count.
- **Flashcards.** Review and test sessions are more reliable: they no longer render over the window's title bar, which could make the close and settings buttons stop responding and leave you unable to exit the session, their keyboard shortcuts now appear in the Keyboard settings page where they can be remapped or turned off, a failed grade confirmation no longer resets the card to looking unanswered and instead offers a retry, and suspending every card in a deck now shows a confirmation while answer reveals and queue advances are announced for screen readers.
- **Mind maps.** Editing a mind map no longer risks losing changes in a few situations that used to corrupt or drop them, and undo no longer reorders a map's branches as a side effect.
- **Mind maps.** A mind map library that contains one unreadable map, or an imported file with one unreadable map inside it, now still opens and skips only the bad one, instead of failing to load entirely.
- **Mind maps.** Mind map keyboard shortcuts now honor whatever they have been rebound to in the Keyboard settings, and the tool dock shows whichever key is currently bound. They previously kept responding to the original key regardless of how it was rebound.
- **Mind maps.** A node now resizes correctly as its label is typed, and its edges stay attached and follow along, instead of the node, its label, and its edges falling out of sync with each other.
- **Mind maps.** A node's label editor no longer closes while it is still being typed into, dragging or scrolling on the canvas no longer accidentally pins or moves untouched nodes, and Tab or Enter no longer trigger a mind map action when focus is actually on a toolbar button or menu. The delete option in a node's menu also now shows how many elements it will remove, including anything collapsed underneath, instead of always just saying Delete.
- **Mind maps.** Applying a color or shape from the style palette now reaches a pinned node in the group too, and the map's root node keeps its own shape and color instead of reverting to the default.
- **Mind maps.** Automatically arranging a map now works when its link edges connect elements outside the usual parent to child tree, instead of failing.
- **Mind maps.** Creating a new mind map now opens directly into the editor, instead of occasionally getting stuck on a screen that only says Loading.
- **Mind maps.** The minimap and library thumbnails now show a plain node clearly at every zoom level, instead of it sometimes rendering as an invisible white mark on the white background. The background grid and node edges also stay crisp and correctly drawn at any zoom level, including the fully zoomed out overview, and the minimap's camera box now tracks the real viewport.
- **Mind maps.** Closing the window now waits for a mind map write that is still on its way to the server, so the last drag, delete, arrange or label edit before an exit is kept.
- **Mind maps.** On macOS and Linux, panning a mind map now works, line ends take their line's colour, and the label field widens as you type.
- **Overview and settings.** A chosen theme could silently fail to survive a restart and quietly revert to the default. Theme choices are now stored reliably and carry forward.
- **Overview and settings.** Dropping a dragged dashboard widget now lands it in the cell the drop preview showed, instead of a neighboring one.
- **Overview and settings.** Study activity and streaks are now counted against your study day instead of UTC midnight, so an evening session is no longer logged as tomorrow, or double counted as a second day.
- **Overview and settings.** Settings no longer offers switches and options that did nothing, such as a performance diagnostics toggle and mindmap grid options nothing read. A few that could be fixed now work: turning off toast notifications actually suppresses them, and the sidebar updates immediately after enabling a module instead of requiring a restart.
- **Overview and settings.** The trash page's countdown, its detail text, and the wording for deleting several items at once were all corrected, and restoring an item now updates every open view that should show it again, not just one.
- **Overview and settings.** Hovering a control now shows a tooltip with its name and, when it has one, its keyboard shortcut. It previously could show alongside the browser's own tooltip, or be replaced by it entirely; now only Mnemo's tooltip appears.
- **Overview and settings.** Right clicking anywhere in the app no longer opens the browser's own menu with Back, Reload, Save As, and Print. Text fields and the note editor still show the native menu, since that is where spelling suggestions and clipboard commands live.
- **Overview and settings.** The command palette's built in actions, like toggling the theme or the sidebar, are now translated instead of always appearing in English, and a remapped keyboard shortcut on macOS that needs both Command and Control now shows Control in its label instead of dropping it.
- **Overview and settings.** A dialog that opens a menu, such as a note's ignored words list, no longer closes when the menu is dismissed with Escape, and keyboard focus now moves into the dialog when it opens, including when it was opened from another menu.
- **Overview and settings.** The personal dictionary no longer treats an accented word as still misspelled just because it was typed with a different, visually identical encoding, and it no longer accepts entries that could never be flagged in the first place, such as phrases or single letters. The spelling settings page also stopped showing a duplicated heading and a status line under every language when there was nothing worth reporting.
- **App and platform.** When a save, export or delete fails, the message says what failed and why in the language you are reading.
- **App and platform.** Data kept in the browser, like an unsaved draft, now survives an app restart, because the app always uses the same local network port instead of a random one each time.
- **App and platform.** The app now warns before a reload or navigation would discard unsaved edits in a note, card, card type, or review preset. It also blocks the browser's default reload and print shortcuts in favor of its own.
- **App and platform.** Closing the app now waits for pending saves to finish first, instead of potentially losing the last few seconds of changes.
- **App and platform.** A failed update install can now be retried instead of leaving the app stuck. An update that was still waiting when you closed the app is shown again the next time you open it instead of being forgotten.
- **App and platform.** Upgrading no longer resets a previously chosen dark theme back to light.
- **App and platform.** If part of the app fails to render, or a page gets stuck crashing on reload, it now shows a recovery option or returns you to the overview instead of a blank window. A failed save or data load also now shows a message instead of failing silently.
- **App and platform.** Opening a menu no longer blocks the rest of the page from responding while it is open.
- **App and platform.** Exporting or downloading a file whose name matches a reserved Windows device name is now renamed automatically instead of failing silently.
- **App and platform.** Warnings from an import now appear as a toast on the notes and mindmap screens, grouped by reason with a count and a few examples, instead of being silently dropped, and review history brought in through an import stays correctly marked even after a backup and restore.
- **App and platform.** Importing a package whose items you deleted, while they are still in the trash, now brings them in as new copies instead of importing nothing, with the links between them pointing at the copies.
- **App and platform.** Settings no longer reports a release candidate as up to date on a channel that never carries it, such as Nightly; it says the channel has not caught up yet.
- **App and platform.** A stray second copy of the app is no longer left in macOS and Linux installs, where launching it started a broken instance.
- **App and platform.** The Typst binary is now marked executable when it is restored on macOS and Linux, so PDF export works in packages built there.
- **App and platform.** A setting that cannot be saved now reports the failure instead of appearing saved until the next launch.
- **App and platform.** A crash after startup now shows a message saying where the details were written, rather than the window disappearing with nothing said.
- **App and platform.** Opening a library written by a newer version of Mnemo is now refused with an explanation, instead of being read through older assumptions.

### Security

- Updated PDF.js to 6.3.289 to address a script execution vulnerability in earlier versions.

### Removed

- **Flashcards.** SM2, Leitner and Baseline scheduling have been removed, leaving FSRS as the only scheduler. Cards in affected decks arrive due now. Their review history is kept, while due dates and counters reset.
- **Overview and settings.** The separate setting for the browser's own spellcheck engine is gone. Right clicking a misspelled word only ever offered Mnemo's own suggestions, so the browser engine's setting did nothing.
- **Soma.** Learning Path, the AI-generated study plan feature, has been removed.
- **Soma.** Attaching a voice recording to a chat message has been removed, along with the speech-to-text handling behind it.
