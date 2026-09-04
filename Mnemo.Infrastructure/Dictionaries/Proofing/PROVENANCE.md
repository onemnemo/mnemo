# Proofing dictionaries

Every file in this folder was downloaded from the pinned archive named below and copied out
unmodified. `manifest.json` records the archive URL, its version, the SHA-256 of the archive as
downloaded, and the SHA-256 of each extracted file. A test recomputes the per-file hashes on every
run, so a file edited in place fails the build rather than shipping silently.

Both affix files declare `SET UTF-8`, so no code page provider is needed to load them.

## en-US

- Archive: `https://github.com/en-wl/wordlist/releases/download/rel-2026.02.25/hunspell-en_US-2026.02.25.zip`
- Version: 2026.02.25, 187,271 bytes
- SHA-256: `ac8e73310e951d88c52c2cf2ba54ceaca34f8486a81630ac8a75dc5f931179f9`
- Files kept: `en_US.aff`, `en_US.dic`, `README_en_US.txt`
- Encoding: `SET UTF-8` (line 9 of `en_US.aff`)

The dictionary is generated from SCOWL and is a collective work assembled from several permissively
licensed word lists. `README_en_US.txt` is the only place those copyright and permission notices
exist, and the terms require them to travel with every copy, so it is kept verbatim beside the
`.aff` and `.dic` and is never edited. The terms carry no copyleft and no source offer.

## es-ES

- Archive: `https://github.com/sbosio/rla-es/releases/download/v2.9/es_ES.oxt`
- Version: 2.9, 1,423,283 bytes
- SHA-256: `3eea87836b24b6004aa1ee6fd285b6c71774b0996aec70d096d75d5526efb4ac`
- Files kept: `es_ES.aff`, `es_ES.dic`, `LICENSE.md`, `README.txt`
- Encoding: `SET UTF-8`, `FLAG UTF-8` (lines 1 and 2 of `es_ES.aff`)

The `.oxt` is a zip holding a hyphenation dictionary and a thesaurus as well; only the spelling pair
and its notices are kept. rla-es is offered under GPLv3, LGPLv3 or MPL 1.1 at the recipient's
choice, and Mnemo exercises the **MPL 1.1** option, the same option it exercises for the engine. The
MPL 1.1 text ships once at `LICENSES/MPL-1.1.txt`, which the publish step copies into every packaged
build. `THIRD-PARTY-NOTICES` carries the section 3.6 source availability notice naming the upstream
repository and tag.

## Languages that are not bundled

- German and Norwegian Bokmal are reported by the status endpoint as absent. German is available in
  practice only as GPLv2 or GPLv3 material whose source obligation is not satisfiable by shipping
  the generated word list alone, and Norwegian Bokmal drags GPLv2 in through its affix file and is
  roughly nine megabytes of word list.
- Japanese has no Hunspell dictionary anywhere, and the Hunspell format cannot express Japanese
  segmentation, so it is not a gap to fill.
