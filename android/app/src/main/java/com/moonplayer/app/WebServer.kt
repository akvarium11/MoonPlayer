package com.moonplayer.app

import android.content.Context
import android.media.MediaMetadataRetriever
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder

class WebServer(private val context: Context, port: Int = 7644) : NanoHTTPD("127.0.0.1", port) {

    val soundCloudService = SoundCloudService(context)

    companion object {
        const val PORT = 7644
        private val MIME_TYPES = mapOf(
            "html" to "text/html",
            "htm" to "text/html",
            "css" to "text/css",
            "js" to "application/javascript",
            "json" to "application/json",
            "png" to "image/png",
            "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg",
            "webp" to "image/webp",
            "svg" to "image/svg+xml",
            "ico" to "image/x-icon",
            "mp3" to "audio/mpeg",
            "flac" to "audio/flac",
            "ogg" to "audio/ogg",
            "wav" to "audio/wav",
            "m4a" to "audio/mp4",
            "aac" to "audio/aac",
            "webm" to "audio/webm",
            "opus" to "audio/opus",
            "woff" to "font/woff",
            "woff2" to "font/woff2",
            "ttf" to "font/ttf"
        )
    }

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        val method = session.method

        if (method == Method.OPTIONS) {
            val resp = newFixedLengthResponse(Response.Status.OK, "text/plain", null, 0)
            addCorsHeaders(resp)
            return resp
        }

        try {
            val params = session.parameters

            // API: /api/songs
            if (uri == "/api/songs") {
                val json = MediaScanner.getAllSongsJson(context)
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
                addCorsHeaders(resp)
                return resp
            }

            // API: /api/folders
            if (uri == "/api/folders") {
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", "[\"/storage/emulated/0/Music\"]")
                addCorsHeaders(resp)
                return resp
            }

            // API: /api/stream or /api/stream/:filename
            if (uri.startsWith("/api/stream")) {
                val filePathParam = params["path"]?.firstOrNull()
                if (filePathParam != null) {
                    val decodedPath = URLDecoder.decode(filePathParam, "UTF-8")
                    val file = File(decodedPath)
                    if (file.exists() && file.isFile) {
                        return serveFileRange(file, session.headers)
                    }
                }
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "File not found")
            }

            // API: /api/flac-cover
            if (uri == "/api/flac-cover") {
                val filePathParam = params["path"]?.firstOrNull()
                if (filePathParam != null) {
                    val decodedPath = URLDecoder.decode(filePathParam, "UTF-8")
                    val file = File(decodedPath)
                    if (file.exists()) {
                        try {
                            val mmr = MediaMetadataRetriever()
                            mmr.setDataSource(file.absolutePath)
                            val art = mmr.embeddedPicture
                            mmr.release()
                            if (art != null && art.isNotEmpty()) {
                                val bais = ByteArrayInputStream(art)
                                val resp = newFixedLengthResponse(Response.Status.OK, "image/jpeg", bais, art.size.toLong())
                                resp.addHeader("Cache-Control", "public, max-age=86400")
                                addCorsHeaders(resp)
                                return resp
                            }
                        } catch (e: Exception) {
                            // Fallback to directory cover
                        }

                        // Check parent folder for cover image
                        val parent = file.parentFile
                        if (parent != null && parent.isDirectory) {
                            val coverFile = parent.listFiles()?.firstOrNull { f ->
                                val name = f.nameWithoutExtension.lowercase()
                                val ext = f.extension.lowercase()
                                (ext == "jpg" || ext == "jpeg" || ext == "png" || ext == "webp") &&
                                (name.contains("cover") || name.contains("folder") || name.contains("album") || name.contains("front"))
                            }
                            if (coverFile != null && coverFile.exists()) {
                                return serveFileRange(coverFile, session.headers)
                            }
                        }
                    }
                }
                return serveAsset("/assets/icon.png")
            }

            // API: /api/cover-art
            if (uri == "/api/cover-art") {
                val title = params["title"]?.firstOrNull() ?: ""
                val artist = params["artist"]?.firstOrNull() ?: ""
                val coverUrl = searchCoverArtOnline(title, artist)
                val json = JSONObject()
                json.put("success", coverUrl != null)
                json.put("coverUrl", coverUrl ?: JSONObject.NULL)
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json.toString())
                addCorsHeaders(resp)
                return resp
            }

            // API: /api/artist-info
            if (uri == "/api/artist-info") {
                val artist = params["artist"]?.firstOrNull() ?: ""
                val json = fetchLastFmArtist(artist)
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
                addCorsHeaders(resp)
                return resp
            }

            // API: /api/album-info
            if (uri == "/api/album-info") {
                val artist = params["artist"]?.firstOrNull() ?: ""
                val album = params["album"]?.firstOrNull() ?: ""
                val json = fetchLastFmAlbum(artist, album)
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
                addCorsHeaders(resp)
                return resp
            }

            // API: /api/soundcloud/*
            if (uri.startsWith("/api/soundcloud/")) {
                return handleSoundCloud(uri, params, session)
            }

            // Static Files from Assets
            return serveAsset(uri)

        } catch (e: Exception) {
            e.printStackTrace()
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", e.message ?: "Server Error")
        }
    }

    private fun addCorsHeaders(resp: Response) {
        resp.addHeader("Access-Control-Allow-Origin", "*")
        resp.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD, PUT, DELETE")
        resp.addHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, User-Agent")
        resp.addHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")
    }

    private fun serveAsset(uri: String): Response {
        var cleanUri = uri.substringBefore("?").trim()
        if (cleanUri == "/" || cleanUri.isEmpty()) {
            cleanUri = "/index.html"
        }
        val assetPath = cleanUri.removePrefix("/")

        try {
            val inputStream = context.assets.open(assetPath)
            val ext = assetPath.substringAfterLast('.', "html").lowercase()
            val mime = MIME_TYPES[ext] ?: "application/octet-stream"

            val available = inputStream.available().toLong()
            val resp = newFixedLengthResponse(Response.Status.OK, mime, inputStream, available)
            if (ext == "html" || ext == "js" || ext == "css") {
                resp.addHeader("Cache-Control", "no-cache")
            } else {
                resp.addHeader("Cache-Control", "public, max-age=86400")
            }
            addCorsHeaders(resp)
            return resp
        } catch (e: IOException) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Asset not found: $assetPath")
        }
    }

    private fun serveFileRange(file: File, headers: Map<String, String>): Response {
        val fileLen = file.length()
        val ext = file.extension.lowercase()
        val mime = MIME_TYPES[ext] ?: "application/octet-stream"

        val rangeHeader = headers["range"]
        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            val rangeVal = rangeHeader.substring(6).trim()
            var start: Long = 0
            var end: Long = fileLen - 1

            val dash = rangeVal.indexOf('-')
            if (dash != -1) {
                val startStr = rangeVal.substring(0, dash).trim()
                val endStr = rangeVal.substring(dash + 1).trim()
                if (startStr.isNotEmpty()) {
                    start = startStr.toLongOrNull() ?: 0
                }
                if (endStr.isNotEmpty()) {
                    end = endStr.toLongOrNull() ?: (fileLen - 1)
                }
            }

            if (start > end || start >= fileLen) {
                val errResp = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "")
                errResp.addHeader("Content-Range", "bytes */$fileLen")
                addCorsHeaders(errResp)
                return errResp
            }

            if (end >= fileLen) end = fileLen - 1
            val contentLen = end - start + 1

            val raf = RandomAccessFile(file, "r")
            raf.seek(start)

            val stream = object : InputStream() {
                var bytesRemaining = contentLen
                override fun read(): Int {
                    if (bytesRemaining <= 0) return -1
                    val b = raf.read()
                    if (b != -1) bytesRemaining--
                    return b
                }
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (bytesRemaining <= 0) return -1
                    val toRead = minOf(len.toLong(), bytesRemaining).toInt()
                    val count = raf.read(b, off, toRead)
                    if (count > 0) bytesRemaining -= count
                    return count
                }
                override fun close() {
                    raf.close()
                }
            }

            val resp = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mime, stream, contentLen)
            resp.addHeader("Content-Range", "bytes $start-$end/$fileLen")
            resp.addHeader("Accept-Ranges", "bytes")
            resp.addHeader("Content-Length", contentLen.toString())
            addCorsHeaders(resp)
            return resp
        }

        // Full file response
        val fis = FileInputStream(file)
        val resp = newFixedLengthResponse(Response.Status.OK, mime, fis, fileLen)
        resp.addHeader("Accept-Ranges", "bytes")
        resp.addHeader("Content-Length", fileLen.toString())
        addCorsHeaders(resp)
        return resp
    }

    private fun searchCoverArtOnline(title: String, artist: String): String? {
        if (title.isBlank() && artist.isBlank()) return null
        // Deezer search API
        try {
            val q = URLEncoder.encode("$artist $title", "UTF-8")
            val url = URL("https://api.deezer.com/search?q=$q&limit=1")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 3000
            conn.readTimeout = 3000
            conn.setRequestProperty("User-Agent", "MoonPlayer/2.2")
            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(body)
                val data = json.optJSONArray("data")
                if (data != null && data.length() > 0) {
                    val track = data.getJSONObject(0)
                    val album = track.optJSONObject("album")
                    val cover = album?.optString("cover_medium") ?: album?.optString("cover_big")
                    if (!cover.isNullOrBlank()) return cover
                }
            }
        } catch (e: Exception) {}

        // iTunes fallback
        try {
            val q = URLEncoder.encode("$artist $title", "UTF-8")
            val url = URL("https://itunes.apple.com/search?term=$q&media=music&entity=song&limit=1")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 3000
            conn.readTimeout = 3000
            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(body)
                val results = json.optJSONArray("results")
                if (results != null && results.length() > 0) {
                    val item = results.getJSONObject(0)
                    val artwork = item.optString("artworkUrl100")
                    if (!artwork.isNullOrBlank()) {
                        return artwork.replace("100x100bb", "600x600bb")
                    }
                }
            }
        } catch (e: Exception) {}

        return null
    }

    private fun fetchLastFmArtist(artist: String): String {
        val clean = artist.trim()
        if (clean.isBlank()) return "{\"success\":false}"
        try {
            val encoded = URLEncoder.encode(clean, "UTF-8")
            val url = URL("https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=$encoded&api_key=b25b959554ed76058ac220b7b2e0a026&format=json")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 4000
            conn.readTimeout = 4000
            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val root = JSONObject(body)
                val artObj = root.optJSONObject("artist") ?: return "{\"success\":false}"
                val bio = artObj.optJSONObject("bio")?.optString("summary") ?: ""
                val cleanBio = bio.replace(Regex("<a\\b[^>]*>.*?</a>", RegexOption.IGNORE_CASE), "").trim()

                val result = JSONObject()
                result.put("success", true)
                result.put("name", artObj.optString("name", clean))
                result.put("bio", cleanBio)
                return result.toString()
            }
        } catch (e: Exception) {}
        return "{\"success\":false}"
    }

    private fun fetchLastFmAlbum(artist: String, album: String): String {
        val cleanArtist = artist.trim()
        val cleanAlbum = album.trim()
        if (cleanAlbum.isBlank()) return "{\"success\":false}"
        try {
            val encArt = URLEncoder.encode(cleanArtist, "UTF-8")
            val encAlb = URLEncoder.encode(cleanAlbum, "UTF-8")
            val url = URL("https://ws.audioscrobbler.com/2.0/?method=album.getInfo&artist=$encArt&album=$encAlb&api_key=b25b959554ed76058ac220b7b2e0a026&format=json")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 4000
            conn.readTimeout = 4000
            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val root = JSONObject(body)
                val albObj = root.optJSONObject("album") ?: return "{\"success\":false}"
                val wiki = albObj.optJSONObject("wiki")?.optString("summary") ?: ""
                val cleanWiki = wiki.replace(Regex("<a\\b[^>]*>.*?</a>", RegexOption.IGNORE_CASE), "").trim()

                val result = JSONObject()
                result.put("success", true)
                result.put("title", albObj.optString("name", cleanAlbum))
                result.put("artist", albObj.optString("artist", cleanArtist))
                result.put("wiki", cleanWiki)
                return result.toString()
            }
        } catch (e: Exception) {}
        return "{\"success\":false}"
    }

    private fun handleSoundCloud(uri: String, params: Map<String, List<String>>, session: IHTTPSession): Response {
        val method = session.method

        // GET or POST /api/soundcloud/config
        if (uri == "/api/soundcloud/config") {
            if (method == Method.POST) {
                var newEnabled: Boolean? = null
                var newToken: String? = null
                try {
                    val files = HashMap<String, String>()
                    session.parseBody(files)
                    val postData = files["postData"]
                    if (postData != null) {
                        val json = JSONObject(postData)
                        if (json.has("enabled")) newEnabled = json.getBoolean("enabled")
                        if (json.has("oauthToken")) newToken = json.getString("oauthToken")
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                val updatedCfg = soundCloudService.saveConfig(newEnabled, newToken)
                val out = JSONObject()
                out.put("success", true)
                out.put("config", JSONObject(updatedCfg))
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", out.toString())
                addCorsHeaders(resp)
                return resp
            } else {
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", soundCloudService.getConfigJson())
                addCorsHeaders(resp)
                return resp
            }
        }

        // GET /api/soundcloud/user
        if (uri == "/api/soundcloud/user") {
            try {
                val user = soundCloudService.verifyToken(soundCloudService.oauthToken)
                val out = JSONObject()
                out.put("success", true)
                out.put("user", user)
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", out.toString())
                addCorsHeaders(resp)
                return resp
            } catch (e: Exception) {
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", "{\"success\":false,\"error\":\"${e.message}\"}")
                addCorsHeaders(resp)
                return resp
            }
        }

        // GET /api/soundcloud/search
        if (uri == "/api/soundcloud/search") {
            val q = params["q"]?.firstOrNull() ?: ""
            val limit = params["limit"]?.firstOrNull()?.toIntOrNull() ?: 25
            val type = params["type"]?.firstOrNull() ?: "all"
            val json = try {
                soundCloudService.search(q, limit, type)
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/track/*
        if (uri.startsWith("/api/soundcloud/track/")) {
            val id = uri.substringAfterLast("/")
            val json = try {
                soundCloudService.getTrack(id)
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/playlist/* or /api/soundcloud/album/*
        if (uri.startsWith("/api/soundcloud/playlist/") || uri.startsWith("/api/soundcloud/album/")) {
            val id = uri.substringAfterLast("/")
            val json = try {
                soundCloudService.getPlaylist(id)
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/station/* or /api/soundcloud/wave/*
        if (uri.startsWith("/api/soundcloud/station/") || uri.startsWith("/api/soundcloud/wave/")) {
            val id = uri.substringAfterLast("/")
            val json = try {
                soundCloudService.getTrackStation(id)
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/artist/*
        if (uri.startsWith("/api/soundcloud/artist/")) {
            val id = uri.substringAfterLast("/")
            val json = try {
                soundCloudService.getArtist(id)
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/likes
        if (uri == "/api/soundcloud/likes") {
            val limit = params["limit"]?.firstOrNull()?.toIntOrNull() ?: 50
            val offset = params["offset"]?.firstOrNull()?.toIntOrNull() ?: 0
            val json = try {
                soundCloudService.getUserLikes(limit, offset)
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/playlists or /api/soundcloud/user/playlists
        if (uri == "/api/soundcloud/playlists" || uri == "/api/soundcloud/user/playlists") {
            val json = try {
                soundCloudService.getUserPlaylists()
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/resolve
        if (uri == "/api/soundcloud/resolve") {
            val targetUrl = params["url"]?.firstOrNull() ?: ""
            val json = try {
                soundCloudService.resolve(targetUrl)
            } catch (e: Exception) {
                e.printStackTrace()
                "{\"success\":false,\"error\":\"${e.message}\"}"
            }
            val resp = newFixedLengthResponse(Response.Status.OK, "application/json", json)
            addCorsHeaders(resp)
            return resp
        }

        // GET /api/soundcloud/stream/*
        if (uri.startsWith("/api/soundcloud/stream/")) {
            val cleanUri = uri.substringBefore("?").trimEnd('/')
            val trackId = cleanUri.substringAfterLast("/")
            return serveSoundCloudStream(trackId, session)
        }

        // POST /api/soundcloud/download-to-library
        if (uri == "/api/soundcloud/download-to-library") {
            try {
                val files = HashMap<String, String>()
                session.parseBody(files)
                val postData = files["postData"]
                val json = if (postData != null) JSONObject(postData) else JSONObject()
                val trackId = json.optString("trackId", "")
                val result = soundCloudService.downloadTrackToLibrary(trackId)
                val resp = newFixedLengthResponse(Response.Status.OK, "application/json", result.toString())
                addCorsHeaders(resp)
                return resp
            } catch (e: Exception) {
                e.printStackTrace()
                val resp = newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json", "{\"success\":false,\"error\":\"${e.message}\"}")
                addCorsHeaders(resp)
                return resp
            }
        }

        // Fallback
        val fallbackJson = JSONObject()
        fallbackJson.put("success", false)
        fallbackJson.put("message", "SoundCloud route not found")
        val resp = newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", fallbackJson.toString())
        addCorsHeaders(resp)
        return resp
    }

    private fun serveSoundCloudStream(trackId: String, session: IHTTPSession): Response {
        try {
            var streamUrl = soundCloudService.getStreamUrl(trackId)
            val rangeHeader = session.headers["range"]
            var conn = openStreamConnection(streamUrl, rangeHeader)

            // If CloudFront signed URL expired (401/403/410/404), refresh stream URL and retry once
            var code = conn.responseCode
            if (code == 401 || code == 403 || code == 410 || code == 404) {
                soundCloudService.clearStreamCache(trackId)
                streamUrl = soundCloudService.getStreamUrl(trackId, forceRefresh = true)
                conn.disconnect()
                conn = openStreamConnection(streamUrl, rangeHeader)
                code = conn.responseCode
            }

            if (code !in 200..299) {
                conn.disconnect()
                val errResp = newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "SoundCloud CDN returned HTTP $code")
                addCorsHeaders(errResp)
                return errResp
            }

            val rawMime = conn.contentType?.substringBefore(";")?.trim()
            val mime = if (rawMime.isNullOrBlank() || rawMime == "application/octet-stream" || rawMime == "binary/octet-stream") {
                "audio/mpeg"
            } else {
                rawMime
            }
            val contentLength = conn.contentLengthLong
            val contentRange = conn.getHeaderField("Content-Range")
            val status = if (code == 206) Response.Status.PARTIAL_CONTENT else Response.Status.OK

            val bufferedInput = java.io.BufferedInputStream(conn.inputStream, 65536)
            val wrappedStream = object : FilterInputStream(bufferedInput) {
                override fun close() {
                    try {
                        super.close()
                    } finally {
                        try {
                            conn.disconnect()
                        } catch (e: Exception) {}
                    }
                }
            }

            val resp = if (contentLength >= 0) {
                newFixedLengthResponse(status, mime, wrappedStream, contentLength)
            } else {
                newChunkedResponse(status, mime, wrappedStream)
            }

            resp.addHeader("Accept-Ranges", "bytes")
            if (!contentRange.isNullOrBlank()) {
                resp.addHeader("Content-Range", contentRange)
            }
            addCorsHeaders(resp)
            return resp
        } catch (e: Exception) {
            e.printStackTrace()
            val errResp = newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Stream error: ${e.message}")
            addCorsHeaders(errResp)
            return errResp
        }
    }

    private fun openStreamConnection(streamUrl: String, rangeHeader: String?): HttpURLConnection {
        val conn = URL(streamUrl).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 20000
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        if (!rangeHeader.isNullOrBlank()) {
            conn.setRequestProperty("Range", rangeHeader)
        }
        conn.connect()
        return conn
    }
}
