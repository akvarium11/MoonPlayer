package com.moonplayer.app

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Environment
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class SoundCloudService(private val context: Context) {

    private val prefs = context.getSharedPreferences("moonplayer_sc_config", Context.MODE_PRIVATE)
    private val streamUrlCache = mutableMapOf<String, Pair<String, Long>>()

    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(value) = prefs.edit().putBoolean("enabled", value).apply()

    var oauthToken: String
        get() = prefs.getString("oauthToken", "") ?: ""
        set(value) = prefs.edit().putString("oauthToken", value).apply()

    var cachedUserJson: String?
        get() = prefs.getString("cachedUserJson", null)
        set(value) = prefs.edit().putString("cachedUserJson", value).apply()

    private val trackCache = mutableMapOf<String, JSONObject>()
    private val transcodingsCache = mutableMapOf<String, JSONArray>()

    fun getConfigJson(): String {
        val root = JSONObject()
        root.put("enabled", enabled)
        root.put("hasToken", oauthToken.isNotBlank())
        val userStr = cachedUserJson
        if (!userStr.isNullOrBlank()) {
            try {
                root.put("user", JSONObject(userStr))
            } catch (e: Exception) {
                root.put("user", JSONObject.NULL)
            }
        } else {
            root.put("user", JSONObject.NULL)
        }
        return root.toString()
    }

    fun saveConfig(newEnabled: Boolean?, newToken: String?): String {
        if (newToken != null) {
            val clean = newToken.trim()
            oauthToken = clean
            if (clean.isNotBlank()) {
                try {
                    verifyToken(clean)
                    enabled = true
                } catch (e: Exception) {
                    e.printStackTrace()
                    cachedUserJson = null
                }
            } else {
                cachedUserJson = null
            }
        }
        if (newEnabled != null) {
            enabled = newEnabled
        }
        return getConfigJson()
    }

    fun verifyToken(token: String): JSONObject {
        val cleanToken = token.trim()
        if (cleanToken.isBlank()) {
            throw Exception("OAuth token cannot be empty")
        }
        val url = URL("https://api-v2.soundcloud.com/me")
        val conn = url.openConnection() as HttpURLConnection
        conn.setRequestProperty("Authorization", "OAuth $cleanToken")
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        conn.connectTimeout = 6000
        conn.readTimeout = 6000

        if (conn.responseCode != 200) {
            throw Exception("SoundCloud verification failed (${conn.responseCode})")
        }

        val body = conn.inputStream.bufferedReader().readText()
        val data = JSONObject(body)
        val user = JSONObject()
        user.put("id", data.optLong("id"))
        user.put("username", data.optString("username"))
        user.put("full_name", data.optString("full_name"))
        user.put("avatar_url", data.optString("avatar_url"))
        user.put("likes_count", data.optInt("likes_count"))
        user.put("track_count", data.optInt("track_count"))

        cachedUserJson = user.toString()
        return user
    }

    private fun getAuthHeaders(): Map<String, String> {
        val headers = mutableMapOf<String, String>()
        val token = oauthToken.trim()
        if (token.isNotBlank()) {
            headers["Authorization"] = "OAuth $token"
        }
        headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        return headers
    }

    private fun httpGet(urlStr: String): String {
        val url = URL(urlStr)
        val conn = url.openConnection() as HttpURLConnection
        getAuthHeaders().forEach { (k, v) -> conn.setRequestProperty(k, v) }
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        if (conn.responseCode in 200..299) {
            return conn.inputStream.bufferedReader().readText()
        }
        throw Exception("HTTP ${conn.responseCode} for $urlStr")
    }

    fun formatTrack(t: JSONObject, fallbackCover: String? = null, albumTitle: String? = null): JSONObject? {
        val raw = if (t.has("track")) t.optJSONObject("track") ?: t else t
        val id = raw.optLong("id", 0L)
        if (id == 0L) return null

        val artwork = raw.optString("artwork_url", "")
        val userObj = raw.optJSONObject("user")
        val userAvatar = userObj?.optString("avatar_url", "") ?: ""

        val cover = if (artwork.isNotBlank()) {
            artwork.replace("-large", "-t500x500")
        } else if (fallbackCover != null) {
            fallbackCover
        } else if (userAvatar.isNotBlank()) {
            userAvatar.replace("-large", "-t500x500")
        } else {
            "/assets/icon.png"
        }

        val durationSec = Math.round(raw.optDouble("duration", 0.0) / 1000.0)
        val artist = userObj?.optString("username", "SoundCloud Artist") ?: "SoundCloud Artist"
        val title = raw.optString("title", "Untitled")

        val media = raw.optJSONObject("media")
        if (media != null && media.has("transcodings")) {
            val trans = media.optJSONArray("transcodings")
            if (trans != null) {
                transcodingsCache[id.toString()] = trans
            }
        }

        val out = JSONObject()
        out.put("id", id)
        out.put("title", title)
        out.put("artist", artist)
        out.put("album", albumTitle ?: "SoundCloud")
        out.put("albumKey", if (albumTitle != null) "sc_album_${albumTitle.lowercase().replace(Regex("[^a-z0-9]"), "_")}" else "sc_track_$id")
        out.put("year", raw.optString("created_at", "").take(4))
        out.put("cover", cover)
        out.put("folderCoverUrl", cover)
        out.put("duration", durationSec)
        out.put("path", "soundcloud:$id")
        out.put("src", "/api/soundcloud/stream/$id")
        out.put("url", "/api/soundcloud/stream/$id")
        out.put("format", "soundcloud")
        out.put("isSoundCloud", true)
        out.put("likes_count", raw.optInt("likes_count", 0))

        trackCache[id.toString()] = out
        return out
    }

    fun formatPlaylist(p: JSONObject): JSONObject? {
        val id = p.optLong("id", 0L)
        if (id == 0L) return null

        val isAlbum = p.optBoolean("is_album") || p.optString("set_type") == "album"
        val artwork = p.optString("artwork_url", "")
        val userObj = p.optJSONObject("user")
        val userAvatar = userObj?.optString("avatar_url", "") ?: ""
        val cover = if (artwork.isNotBlank()) {
            artwork.replace("-large", "-t500x500")
        } else if (userAvatar.isNotBlank()) {
            userAvatar.replace("-large", "-t500x500")
        } else {
            "/assets/icon.png"
        }

        val artist = userObj?.optString("username", "SoundCloud Artist") ?: "SoundCloud Artist"
        val playlistTitle = p.optString("title", if (isAlbum) "Untitled Album" else "Untitled Playlist")

        val tracksArr = p.optJSONArray("tracks") ?: JSONArray()
        val formattedTracks = JSONArray()
        for (i in 0 until tracksArr.length()) {
            val t = tracksArr.optJSONObject(i) ?: continue
            formatTrack(t, cover, playlistTitle)?.let { formattedTracks.put(it) }
        }

        val out = JSONObject()
        out.put("id", id)
        out.put("type", if (isAlbum) "album" else "playlist")
        out.put("isAlbum", isAlbum)
        out.put("title", playlistTitle)
        out.put("artist", artist)
        out.put("user", artist)
        out.put("userId", userObj?.optLong("id"))
        out.put("trackCount", p.optInt("track_count", formattedTracks.length()))
        out.put("duration", Math.round(p.optDouble("duration", 0.0) / 1000.0))
        out.put("year", p.optString("created_at", "").take(4))
        out.put("cover", cover)
        out.put("artwork_url", cover)
        out.put("permalink_url", p.optString("permalink_url", ""))
        out.put("likes_count", p.optInt("likes_count", 0))
        out.put("description", p.optString("description", ""))
        out.put("tracks", formattedTracks)
        return out
    }

    fun formatArtist(u: JSONObject): JSONObject? {
        val id = u.optLong("id", 0L)
        if (id == 0L) return null
        val avatar = u.optString("avatar_url", "").replace("-large", "-t500x500").ifBlank { "/assets/icon.png" }
        val name = u.optString("username", u.optString("full_name", "SoundCloud Artist"))

        val out = JSONObject()
        out.put("id", id)
        out.put("type", "artist")
        out.put("name", name)
        out.put("username", u.optString("username", ""))
        out.put("fullName", u.optString("full_name", ""))
        out.put("avatar", avatar)
        out.put("cover", avatar)
        out.put("followersCount", u.optInt("followers_count", 0))
        out.put("trackCount", u.optInt("track_count", 0))
        out.put("playlistCount", u.optInt("playlist_count", 0))
        out.put("description", u.optString("description", ""))
        out.put("city", u.optString("city", ""))
        out.put("country", u.optString("country_code", ""))
        out.put("verified", u.optBoolean("verified", false))
        out.put("permalink_url", u.optString("permalink_url", ""))
        return out
    }

    fun search(q: String, limit: Int, type: String): String {
        val encodedQ = URLEncoder.encode(q, "UTF-8")
        val endpoint = when (type.lowercase()) {
            "all" -> "https://api-v2.soundcloud.com/search?q=$encodedQ&limit=$limit"
            "albums" -> "https://api-v2.soundcloud.com/search/albums?q=$encodedQ&limit=$limit"
            "playlists" -> "https://api-v2.soundcloud.com/search/playlists_without_albums?q=$encodedQ&limit=$limit"
            "artists", "users" -> "https://api-v2.soundcloud.com/search/users?q=$encodedQ&limit=$limit"
            else -> "https://api-v2.soundcloud.com/search/tracks?q=$encodedQ&limit=$limit"
        }

        val body = httpGet(endpoint)
        val root = JSONObject(body)
        val collection = root.optJSONArray("collection") ?: JSONArray()

        val result = JSONObject()
        result.put("success", true)

        if (type.lowercase() == "tracks") {
            val tracks = JSONArray()
            for (i in 0 until collection.length()) {
                val item = collection.optJSONObject(i) ?: continue
                val formatted = formatTrack(item) ?: continue
                tracks.put(formatted)
            }
            result.put("tracks", tracks)
        } else if (type.lowercase() == "all") {
            val tracks = JSONArray()
            val albums = JSONArray()
            val playlists = JSONArray()
            val artists = JSONArray()

            for (i in 0 until collection.length()) {
                val item = collection.optJSONObject(i) ?: continue
                val kind = item.optString("kind", "")
                when (kind) {
                    "track" -> formatTrack(item)?.let { tracks.put(it) }
                    "playlist" -> {
                        val formatted = formatPlaylist(item)
                        if (formatted != null) {
                            if (formatted.optBoolean("isAlbum")) albums.put(formatted) else playlists.put(formatted)
                        }
                    }
                    "user" -> formatArtist(item)?.let { artists.put(it) }
                }
            }
            result.put("tracks", tracks)
            result.put("albums", albums)
            result.put("playlists", playlists)
            result.put("artists", artists)
        } else if (type.lowercase() == "albums" || type.lowercase() == "playlists") {
            val list = JSONArray()
            for (i in 0 until collection.length()) {
                val item = collection.optJSONObject(i) ?: continue
                formatPlaylist(item)?.let { list.put(it) }
            }
            if (type.lowercase() == "albums") result.put("albums", list) else result.put("playlists", list)
        } else if (type.lowercase() == "artists" || type.lowercase() == "users") {
            val list = JSONArray()
            for (i in 0 until collection.length()) {
                val item = collection.optJSONObject(i) ?: continue
                formatArtist(item)?.let { list.put(it) }
            }
            result.put("artists", list)
        } else {
            result.put("collection", collection)
        }

        return result.toString()
    }

    fun resolvePlaylistStubs(data: JSONObject) {
        val tracksArr = data.optJSONArray("tracks") ?: return
        if (tracksArr.length() <= 5) return

        val stubIds = mutableListOf<Long>()
        for (i in 0 until tracksArr.length()) {
            val t = tracksArr.optJSONObject(i) ?: continue
            val id = t.optLong("id", 0L)
            val title = t.optString("title", "")
            val media = t.optJSONObject("media")
            if (id > 0L && (title.isBlank() || media == null)) {
                stubIds.add(id)
            }
        }

        if (stubIds.isEmpty()) return

        val fullMap = mutableMapOf<Long, JSONObject>()
        val chunkSize = 50
        for (i in 0 until stubIds.size step chunkSize) {
            val batch = stubIds.subList(i, minOf(i + chunkSize, stubIds.size))
            val idsParam = batch.joinToString(",")
            try {
                val body = httpGet("https://api-v2.soundcloud.com/tracks?ids=$idsParam")
                val fullTracksArr = JSONArray(body)
                for (j in 0 until fullTracksArr.length()) {
                    val ft = fullTracksArr.optJSONObject(j) ?: continue
                    val fid = ft.optLong("id", 0L)
                    if (fid > 0L) {
                        fullMap[fid] = ft
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        val updatedTracks = JSONArray()
        for (i in 0 until tracksArr.length()) {
            val t = tracksArr.optJSONObject(i) ?: continue
            val id = t.optLong("id", 0L)
            val fullTrack = fullMap[id]
            if (fullTrack != null) {
                updatedTracks.put(fullTrack)
            } else {
                updatedTracks.put(t)
            }
        }
        data.put("tracks", updatedTracks)
    }

    fun getTrack(id: String): String {
        val cleanId = id.removePrefix("soundcloud:")
        val cached = trackCache[cleanId]
        if (cached != null) {
            val result = JSONObject()
            result.put("success", true)
            result.put("track", cached)
            return result.toString()
        }
        val body = httpGet("https://api-v2.soundcloud.com/tracks/$cleanId")
        val root = JSONObject(body)
        val formatted = formatTrack(root) ?: root
        val result = JSONObject()
        result.put("success", true)
        result.put("track", formatted)
        return result.toString()
    }

    fun getPlaylist(id: String): String {
        val body = httpGet("https://api-v2.soundcloud.com/playlists/$id")
        val root = JSONObject(body)
        resolvePlaylistStubs(root)
        val formatted = formatPlaylist(root) ?: root
        val result = JSONObject()
        result.put("success", true)
        result.put("playlist", formatted)
        result.put("album", formatted)
        return result.toString()
    }

    fun getArtist(id: String): String {
        val userBody = httpGet("https://api-v2.soundcloud.com/users/$id")
        val userObj = JSONObject(userBody)
        val artist = formatArtist(userObj) ?: userObj

        val tracks = JSONArray()
        try {
            val trBody = httpGet("https://api-v2.soundcloud.com/users/$id/tracks?limit=30")
            val trArr = JSONObject(trBody).optJSONArray("collection") ?: JSONArray()
            for (i in 0 until trArr.length()) {
                val t = trArr.optJSONObject(i) ?: continue
                formatTrack(t, artist.optString("avatar"))?.let { tracks.put(it) }
            }
        } catch (e: Exception) {}

        val albums = JSONArray()
        try {
            val albBody = httpGet("https://api-v2.soundcloud.com/users/$id/albums?limit=15")
            val albArr = JSONObject(albBody).optJSONArray("collection") ?: JSONArray()
            for (i in 0 until albArr.length()) {
                val a = albArr.optJSONObject(i) ?: continue
                formatPlaylist(a)?.let { albums.put(it) }
            }
        } catch (e: Exception) {}

        val playlists = JSONArray()
        try {
            val plBody = httpGet("https://api-v2.soundcloud.com/users/$id/playlists?limit=15")
            val plArr = JSONObject(plBody).optJSONArray("collection") ?: JSONArray()
            for (i in 0 until plArr.length()) {
                val p = plArr.optJSONObject(i) ?: continue
                formatPlaylist(p)?.let { playlists.put(it) }
            }
        } catch (e: Exception) {}

        artist.put("tracks", tracks)
        artist.put("albums", albums)
        artist.put("playlists", playlists)

        val result = JSONObject()
        result.put("success", true)
        result.put("artist", artist)
        result.put("tracks", tracks)
        result.put("albums", albums)
        result.put("playlists", playlists)
        return result.toString()
    }

    fun resolve(targetUrl: String): String {
        val enc = URLEncoder.encode(targetUrl.trim(), "UTF-8")
        val body = httpGet("https://api-v2.soundcloud.com/resolve?url=$enc")
        val obj = JSONObject(body)
        val kind = obj.optString("kind", "")
        val result = JSONObject()
        result.put("success", true)
        when (kind) {
            "track" -> result.put("data", formatTrack(obj))
            "playlist" -> {
                resolvePlaylistStubs(obj)
                result.put("data", formatPlaylist(obj))
            }
            "user" -> result.put("data", formatArtist(obj))
            else -> result.put("data", obj)
        }
        return result.toString()
    }

    fun getTrackStation(id: String): String {
        val cleanId = id.replace(Regex("^soundcloud:", RegexOption.IGNORE_CASE), "").trim()
        val urlStr = "https://api-v2.soundcloud.com/stations/soundcloud:track-stations:$cleanId/tracks?limit=30"
        var tracks = JSONArray()
        try {
            val body = httpGet(urlStr)
            val root = JSONObject(body)
            val collection = root.optJSONArray("collection") ?: JSONArray()
            for (i in 0 until collection.length()) {
                val t = collection.optJSONObject(i) ?: continue
                formatTrack(t)?.let { tracks.put(it) }
            }
        } catch (e: Exception) {
            // Fallback to related tracks
            try {
                val relBody = httpGet("https://api-v2.soundcloud.com/tracks/$cleanId/related?limit=30")
                val relRoot = JSONObject(relBody)
                val relCol = relRoot.optJSONArray("collection") ?: JSONArray()
                for (i in 0 until relCol.length()) {
                    val t = relCol.optJSONObject(i) ?: continue
                    formatTrack(t)?.let { tracks.put(it) }
                }
            } catch (e2: Exception) {}
        }

        val result = JSONObject()
        result.put("success", true)
        result.put("tracks", tracks)
        return result.toString()
    }

    fun getUserLikes(limit: Int = 50, offset: Int = 0): String {
        val userStr = cachedUserJson
        val userId = if (!userStr.isNullOrBlank()) JSONObject(userStr).optLong("id", 0L) else 0L
        val urlStr = if (userId > 0) {
            "https://api-v2.soundcloud.com/users/$userId/likes?limit=$limit"
        } else {
            "https://api-v2.soundcloud.com/me/likes/tracks?limit=$limit&offset=$offset"
        }
        val body = httpGet(urlStr)
        val root = JSONObject(body)
        val collection = root.optJSONArray("collection") ?: JSONArray()
        val tracks = JSONArray()

        for (i in 0 until collection.length()) {
            val item = collection.optJSONObject(i) ?: continue
            val trackObj = if (item.has("track")) item.optJSONObject("track") ?: item else item
            formatTrack(trackObj)?.let { tracks.put(it) }
        }

        val result = JSONObject()
        result.put("success", true)
        result.put("tracks", tracks)
        result.put("total", root.optInt("total", tracks.length()))
        return result.toString()
    }

    fun getUserPlaylists(): String {
        val userStr = cachedUserJson
        val userId = if (!userStr.isNullOrBlank()) JSONObject(userStr).optLong("id", 0L) else 0L
        val urlStr = if (userId > 0) {
            "https://api-v2.soundcloud.com/users/$userId/playlists"
        } else {
            "https://api-v2.soundcloud.com/me/library/all?limit=50"
        }
        val body = httpGet(urlStr)
        val root = try { JSONObject(body) } catch (e: Exception) { null }
        val collection = root?.optJSONArray("collection") ?: JSONArray()
        val playlists = JSONArray()

        for (i in 0 until collection.length()) {
            val item = collection.optJSONObject(i) ?: continue
            val p = item.optJSONObject("playlist") ?: item
            if (p.has("id")) {
                formatPlaylist(p)?.let { playlists.put(it) }
            }
        }

        val result = JSONObject()
        result.put("success", true)
        result.put("playlists", playlists)
        return result.toString()
    }

    fun clearStreamCache(trackId: String) {
        val cleanId = trackId.replace(Regex("^soundcloud:", RegexOption.IGNORE_CASE), "").trim()
        streamUrlCache.remove(cleanId)
        transcodingsCache.remove(cleanId)
    }

    fun getStreamUrl(trackId: String, forceRefresh: Boolean = false): String {
        val cleanId = trackId.replace(Regex("^soundcloud:", RegexOption.IGNORE_CASE), "").trim()
        val now = System.currentTimeMillis()
        if (!forceRefresh) {
            val cached = streamUrlCache[cleanId]
            if (cached != null && now < cached.second) {
                return cached.first
            }
        }

        var trans = transcodingsCache[cleanId]
        if (trans == null || forceRefresh) {
            val trackBody = httpGet("https://api-v2.soundcloud.com/tracks/$cleanId")
            val trackObj = JSONObject(trackBody)
            val media = trackObj.optJSONObject("media")
            trans = media?.optJSONArray("transcodings")
            if (trans != null) {
                transcodingsCache[cleanId] = trans
            }
        }

        if (trans == null || trans.length() == 0) {
            throw Exception("No transcodings found for track $cleanId")
        }

        var streamEndpoint: String? = null
        // 1. Prefer progressive MP3 / MPEG
        for (i in 0 until trans.length()) {
            val item = trans.getJSONObject(i)
            val format = item.optJSONObject("format")?.optString("protocol", "") ?: ""
            val mime = item.optJSONObject("format")?.optString("mime_type", "") ?: ""
            if (format.equals("progressive", ignoreCase = true) && (mime.contains("mpeg", ignoreCase = true) || mime.contains("mp3", ignoreCase = true))) {
                streamEndpoint = item.optString("url")
                break
            }
        }
        // 2. Fallback to any progressive audio (e.g. mp4, aac)
        if (streamEndpoint.isNullOrBlank()) {
            for (i in 0 until trans.length()) {
                val item = trans.getJSONObject(i)
                val format = item.optJSONObject("format")?.optString("protocol", "") ?: ""
                if (format.equals("progressive", ignoreCase = true)) {
                    streamEndpoint = item.optString("url")
                    break
                }
            }
        }
        // 3. Fallback to HLS MP3
        if (streamEndpoint.isNullOrBlank()) {
            for (i in 0 until trans.length()) {
                val item = trans.getJSONObject(i)
                val format = item.optJSONObject("format")?.optString("protocol", "") ?: ""
                val mime = item.optJSONObject("format")?.optString("mime_type", "") ?: ""
                val preset = item.optString("preset", "")
                if (format.equals("hls", ignoreCase = true) && (mime.contains("mpeg", ignoreCase = true) || preset.contains("mp3", ignoreCase = true))) {
                    streamEndpoint = item.optString("url")
                    break
                }
            }
        }
        // 4. Fallback to first available transcoding
        if (streamEndpoint.isNullOrBlank()) {
            streamEndpoint = trans.getJSONObject(0).optString("url")
        }
        if (streamEndpoint.isNullOrBlank()) {
            throw Exception("No stream URL available for track $cleanId")
        }

        val cdnBody = httpGet(streamEndpoint)
        val cdnJson = JSONObject(cdnBody)
        val finalUrl = cdnJson.optString("url")
        if (finalUrl.isNotBlank()) {
            // Cache CloudFront URL for 2.5 minutes (expires in ~5-6 mins upstream)
            streamUrlCache[cleanId] = Pair(finalUrl, now + 150_000L)
        }
        return finalUrl
    }

    fun downloadTrackToLibrary(trackId: String): JSONObject {
        val cleanId = trackId.replace(Regex("^soundcloud:", RegexOption.IGNORE_CASE), "").trim()
        val streamUrl = getStreamUrl(cleanId)
        var track = trackCache[cleanId]
        if (track == null) {
            val trackBody = httpGet("https://api-v2.soundcloud.com/tracks/$cleanId")
            track = formatTrack(JSONObject(trackBody))
        }

        val artist = track?.optString("artist", "SoundCloud") ?: "SoundCloud"
        val title = track?.optString("title", "Track_$cleanId") ?: "Track_$cleanId"
        val safeName = "${artist} - ${title}".replace(Regex("[\\\\/:*?\"<>|]"), "_") + ".mp3"

        val musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
        val scDir = File(musicDir, "SoundCloud")
        if (!scDir.exists()) scDir.mkdirs()

        val destFile = File(scDir, safeName)
        val conn = URL(streamUrl).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 15000

        conn.inputStream.use { input ->
            FileOutputStream(destFile).use { output ->
                input.copyTo(output)
            }
        }

        // Notify MediaStore
        MediaScannerConnection.scanFile(context, arrayOf(destFile.absolutePath), arrayOf("audio/mpeg"), null)

        val res = JSONObject()
        res.put("success", true)
        res.put("path", destFile.absolutePath)
        res.put("filename", destFile.name)
        return res
    }
}
