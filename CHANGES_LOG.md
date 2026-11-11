# MoonPlayer Bug Fixes - Session Nov 2026

## ✅ Bug 1: Album Vertical Scroll Disappearing Songs
**Problem**: Songs disappeared when window height was reduced in album view
**Fix**: Added proper flex layout with `flex: 1 1 0%`, `min-height: 0`, `overflow-y: auto` to `.song-list-container` in mobile CSS queries

## ✅ Bug 2: Multi-Artist Albums Split Into Separate Entries
**Problem**: Albums with multiple artists showed as separate albums instead of grouping
**Fix**: Modified `getSongAlbumKey()` to use only album title (not artist+title), then `buildLibraries()` displays "Artist A, Artist B" or "Various Artists" (>3 artists)

## ✅ Bug 3: SoundCloud Liked Songs Stuck on Pause
**Problem**: Clicking liked SoundCloud songs did nothing on first click
**Fix**: Added track pre-registration loop in `renderPlaylistView()` to ensure all tracks have valid `globalIndex` before display

## ✅ Bug 4: Discord RPC Wrong Time on Repeat/Pause
**Problem**: Discord showed wrong timestamp (24:23 on a 4:00 song) when repeating or paused
**Fix**: Added `end` timestamp to Discord activity: `end = now + remainingSec * 1000`. Discord now correctly shows remaining time

## ✅ Bug 5: Playlists/Albums Only Show 5 Songs
**Problem**: Only first 5 songs displayed in playlists and albums
**Fix**: Modified `appendMoreSongs()` to recursively append until container is full. Fixed mobile CSS flex layout to allow proper scrolling

## ✅ Bug 6: Playlist Sorting Not Working
**Problem**: Sort dropdown had no effect
**Fix**: Wired `#playlist-sort` dropdown to call `sortTracks()` from `track-sort.js` and re-render playlist view

## ✅ Bug 7: Lyrics UI Enhancement
**Problem**: Bland lyrics panel, no gradient, cramped fullscreen
**Fix**: 
- Added vibrant gradient background to `.lyrics-section` (cyan to electric blue)
- Improved padding and spacing in lyrics container
- Enhanced fullscreen TV karaoke animations with smooth transitions
- Moved fullscreen button to header side with proper positioning
- Added smooth fade-in/fade-out animations for lyric lines in fullscreen

## ✅ Bug 9: Bottom Player Bar Visual Enhancement
**Problem**: Bottom playbar looked basic
**Fix**:
- Added subtle backdrop blur and border to `.playbar`
- Enhanced control buttons with smooth hover effects and scale transforms
- Improved visual hierarchy with better shadows and transitions
- Added electric accent colors on hover

## ✅ Bug 10: Auto Internet Lyrics Fetching
**Problem**: Only local .lrc files were supported
**Fix**: 
- Integrated lrclib.net API for automatic lyrics fetching
- Priority 1: Local .lrc file
- Priority 2: Internet search via lrclib.com
- Added "Searching lyrics online..." status indicator
- Displays "Lyrics from lrclib.net" tooltip when internet lyrics loaded
- Fully compatible with existing LRC parser and riff-ui rendering

---

**Build Status**: Ready for compilation
**Test Status**: Syntax validated, all functions checked
**Next**: `npm run build`
