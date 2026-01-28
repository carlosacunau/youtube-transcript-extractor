# CLAUDE.md

## Project Overview
YouTube Transcript Extractor - A Chrome extension (Manifest V3) that extracts, displays, copies, and downloads YouTube video transcripts with chapter support.

## Project Structure
- `manifest.json` - Extension configuration (MV3)
- `src/content/transcript.js` - Core transcript & chapter extraction logic (multi-fallback)
- `src/content/content.js` - UI injection, rendering, and interaction
- `src/content/styles.css` - Panel styling (light/dark theme)
- `src/background/service-worker.js` - Extension icon click handler
- `icons/` - Extension icons (16/48/128px)

## Key Technical Details
- Transcript extraction uses 3 fallback methods: caption tracks, YouTube internal API, DOM scraping
- Page HTML is cached (`_pageCache`) to avoid duplicate fetches across chapter and caption extraction
- UI is injected into YouTube's `#secondary.style-scope.ytd-watch-flexy` sidebar
- SPA navigation is handled via MutationObserver watching URL changes
- YouTube's native transcript panel is closed after our panel loads to prevent duplicates

## Versioning Rules
Version is tracked in both `manifest.json` and `package.json`. Always keep them in sync.

**Patch bump (x.x.PATCH)** - e.g. 1.0.1 -> 1.0.2:
- Bug fixes
- Style tweaks
- Refactors with no user-facing change
- Minor text or copy changes

**Minor bump (x.MINOR.0)** - e.g. 1.0.2 -> 1.1.0:
- New features (e.g. adding chapters, search, new export format)
- New UI components or panels
- New extraction methods or API integrations

**Major bump (MAJOR.0.0)** - e.g. 1.1.0 -> 2.0.0:
- Breaking changes to extension behavior
- Complete UI overhaul
- Architecture changes (e.g. switching from content script to side panel API)

**Always update the version when committing changes. Never skip this step.**

## Commands
- Load extension: `chrome://extensions` -> Developer mode -> Load unpacked -> select project root
- Reload after changes: Click reload button on extension card in `chrome://extensions`
- Push to GitHub: `git push` (remote: `origin` -> `github.com/carlosacunau/youtube-transcript-extractor`)
