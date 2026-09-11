package com.moonplayer.app

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.media.MediaMetadataRetriever
import android.os.Environment
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder

data class SongItem(
    val path: String,
    val name: String,
    val format: String,
    val url: String,
    val folderCoverUrl: String?,
    val title: String?,
    val artist: String?,
    val album: String?,
    val year: String?,
    val duration: Double = 0.0
)

object MediaScanner {

    private val AUDIO_EXTENSIONS = setOf("mp3", "flac", "ogg", "wav", "m4a", "aac", "webm", "opus")
    private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif")
    private val COVER_KEYWORDS = listOf("cover", "folder", "front", "album", "art", "default")

    private var cachedSongsJson: String? = null
    private var lastScanTime: Long = 0L

    @Synchronized
    fun invalidateCache() {
        cachedSongsJson = null
        lastScanTime = 0L
    }

    fun getAllSongs(context: Context): List<SongItem> {
        val songMap = LinkedHashMap<String, SongItem>()

        // 1. Query MediaStore first (fastest and indexes all external/SD card storage)
        try {
            queryMediaStore(context, songMap)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // 2. Scan standard Music folder directly (/storage/emulated/0/Music) to catch any unindexed files
        try {
            val musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
            if (musicDir != null && musicDir.exists() && musicDir.isDirectory) {
                scanDirectory(musicDir, songMap)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Also check Downloads folder / Music subfolder
        try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (downloadsDir != null && downloadsDir.exists()) {
                val dlMusic = File(downloadsDir, "Music")
                if (dlMusic.exists() && dlMusic.isDirectory) {
                    scanDirectory(dlMusic, songMap)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        return songMap.values.toList()
    }

    @Synchronized
    fun getAllSongsJson(context: Context, forceRefresh: Boolean = false): String {
        val now = System.currentTimeMillis()
        if (!forceRefresh && cachedSongsJson != null && (now - lastScanTime < 60_000)) {
            return cachedSongsJson!!
        }

        val songs = getAllSongs(context)
        val jsonArray = JSONArray()

        for (s in songs) {
            val obj = JSONObject()
            obj.put("path", s.path)
            obj.put("name", s.name)
            obj.put("format", s.format)
            obj.put("url", s.url)
            if (s.duration > 0) {
                obj.put("duration", s.duration)
            }
            if (s.folderCoverUrl != null) {
                obj.put("folderCoverUrl", s.folderCoverUrl)
                obj.put("cover", s.folderCoverUrl)
            }
            if (!s.title.isNullOrBlank()) {
                obj.put("title", s.title)
            }
            if (!s.artist.isNullOrBlank()) {
                obj.put("artist", s.artist)
            }
            if (!s.album.isNullOrBlank()) {
                obj.put("album", s.album)
            }
            if (!s.year.isNullOrBlank()) {
                obj.put("year", s.year)
            }
            jsonArray.put(obj)
        }

        return jsonArray.toString()
    }

    private fun scanDirectory(dir: File, songMap: LinkedHashMap<String, SongItem>) {
        val files = dir.listFiles() ?: return

        var folderCoverFile: File? = null
        for (f in files) {
            if (f.isFile) {
                val ext = f.extension.lowercase()
                if (IMAGE_EXTENSIONS.contains(ext)) {
                    val nameWithoutExt = f.nameWithoutExtension.lowercase()
                    if (COVER_KEYWORDS.any { nameWithoutExt.contains(it) }) {
                        folderCoverFile = f
                        break
                    }
                }
            }
        }
        if (folderCoverFile == null) {
            for (f in files) {
                if (f.isFile && IMAGE_EXTENSIONS.contains(f.extension.lowercase())) {
                    folderCoverFile = f
                    break
                }
            }
        }

        val folderCoverUrl = if (folderCoverFile != null) {
            "/api/stream/${URLEncoder.encode(folderCoverFile.name, "UTF-8")}?path=${URLEncoder.encode(folderCoverFile.absolutePath, "UTF-8")}"
        } else null

        for (file in files) {
            if (file.isDirectory) {
                if (!file.name.startsWith(".")) {
                    scanDirectory(file, songMap)
                }
            } else if (file.isFile) {
                val ext = file.extension.lowercase()
                if (AUDIO_EXTENSIONS.contains(ext)) {
                    val normPath = file.absolutePath.lowercase()
                    if (!songMap.containsKey(normPath)) {
                        val item = parseAudioFile(file, folderCoverUrl)
                        songMap[normPath] = item
                    }
                }
            }
        }
    }

    private fun queryMediaStore(context: Context, songMap: LinkedHashMap<String, SongItem>) {
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.YEAR,
            MediaStore.Audio.Media.DURATION
        )

        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
        val cursor: Cursor? = context.contentResolver.query(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            projection,
            selection,
            null,
            "${MediaStore.Audio.Media.TITLE} ASC"
        )

        cursor?.use {
            val dataCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
            val nameCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
            val titleCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val yearCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)
            val durCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)

            while (it.moveToNext()) {
                val path = it.getString(dataCol) ?: continue
                val normPath = path.lowercase()
                if (songMap.containsKey(normPath)) continue

                val file = File(path)
                if (!file.exists()) continue

                val ext = file.extension.lowercase()
                if (!AUDIO_EXTENSIONS.contains(ext)) continue

                val rawTitle = it.getString(titleCol)
                val rawArtist = it.getString(artistCol)
                val rawAlbum = it.getString(albumCol)
                val year = it.getString(yearCol)
                val durMs = it.getLong(durCol)
                var durSec = if (durMs > 0) durMs / 1000.0 else 0.0
                if (durSec <= 0.0) {
                    try {
                        val mmr = MediaMetadataRetriever()
                        mmr.setDataSource(file.absolutePath)
                        val dStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                        val dMs = dStr?.toLongOrNull() ?: 0L
                        if (dMs > 0) durSec = dMs / 1000.0
                        mmr.release()
                    } catch (_: Exception) {}
                }

                val cleanTitle = if (!rawTitle.isNullOrBlank() && rawTitle != "<unknown>") rawTitle else file.nameWithoutExtension
                val cleanArtist = if (!rawArtist.isNullOrBlank() && rawArtist != "<unknown>") rawArtist else "Unknown Artist"
                val cleanAlbum = if (!rawAlbum.isNullOrBlank() && rawAlbum != "<unknown>") rawAlbum else "Unknown Album"

                val encodedFile = URLEncoder.encode(file.name, "UTF-8")
                val encodedPath = URLEncoder.encode(file.absolutePath, "UTF-8")
                val streamUrl = "/api/stream/$encodedFile?path=$encodedPath"
                val coverUrl = "/api/flac-cover?path=$encodedPath"

                songMap[normPath] = SongItem(
                    path = file.absolutePath,
                    name = file.name,
                    format = ext,
                    url = streamUrl,
                    folderCoverUrl = coverUrl,
                    title = cleanTitle,
                    artist = cleanArtist,
                    album = cleanAlbum,
                    year = year,
                    duration = durSec
                )
            }
        }
    }

    private fun parseAudioFile(file: File, folderCoverUrl: String?): SongItem {
        val ext = file.extension.lowercase()
        val encodedFile = URLEncoder.encode(file.name, "UTF-8")
        val encodedPath = URLEncoder.encode(file.absolutePath, "UTF-8")
        val streamUrl = "/api/stream/$encodedFile?path=$encodedPath"

        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var year: String? = null
        var durSec: Double = 0.0
        val coverUrl = folderCoverUrl ?: "/api/flac-cover?path=$encodedPath"

        try {
            val mmr = MediaMetadataRetriever()
            mmr.setDataSource(file.absolutePath)
            title = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
            artist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
            album = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
            year = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR)
            if (year.isNullOrBlank()) {
                val date = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DATE)
                if (!date.isNullOrBlank() && date.length >= 4) {
                    year = date.substring(0, 4)
                }
            }
            val durStr = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            val durMs = durStr?.toLongOrNull() ?: 0L
            if (durMs > 0) {
                durSec = durMs / 1000.0
            }
            mmr.release()
        } catch (e: Exception) {
            val base = file.nameWithoutExtension
            if (base.contains(" - ")) {
                val parts = base.split(" - ", limit = 2)
                artist = parts[0].trim()
                title = parts[1].trim()
            } else {
                title = base
            }
        }

        return SongItem(
            path = file.absolutePath,
            name = file.name,
            format = ext,
            url = streamUrl,
            folderCoverUrl = coverUrl,
            title = title ?: file.nameWithoutExtension,
            artist = artist ?: "Unknown Artist",
            album = album ?: "Unknown Album",
            year = year,
            duration = durSec
        )
    }
}
