package com.moonplayer.app

import android.webkit.JavascriptInterface
import android.widget.Toast

class AndroidBridge(private val activity: MainActivity) {

    private var currentViewState: String = "library"

    @JavascriptInterface
    fun isAndroid(): Boolean = true

    @JavascriptInterface
    fun updatePlaybackState(
        title: String?,
        artist: String?,
        album: String?,
        coverUrl: String?,
        isPlaying: Boolean,
        positionMs: Long,
        durationMs: Long
    ) {
        updatePlaybackState(title, artist, album, coverUrl, isPlaying, positionMs, durationMs, false)
    }

    @JavascriptInterface
    fun updatePlaybackState(
        title: String?,
        artist: String?,
        album: String?,
        coverUrl: String?,
        isPlaying: Boolean,
        positionMs: Long,
        durationMs: Long,
        isLiked: Boolean
    ) {
        activity.runOnUiThread {
            MusicService.updateTrack(
                context = activity,
                title = title ?: "MoonPlayer",
                artist = artist ?: "Unknown Artist",
                album = album ?: "",
                coverUrl = coverUrl,
                isPlaying = isPlaying,
                positionMs = positionMs,
                durationMs = durationMs,
                isLiked = isLiked
            )
        }
    }

    @JavascriptInterface
    fun setPauseOnZeroVolume(enabled: Boolean) {
        activity.setPauseOnZeroVolume(enabled)
    }

    @JavascriptInterface
    fun getPauseOnZeroVolume(): Boolean {
        return activity.getPauseOnZeroVolume()
    }

    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun setViewState(state: String) {
        currentViewState = state
    }

    @JavascriptInterface
    fun getViewState(): String = currentViewState

    @JavascriptInterface
    fun requestStoragePermission() {
        activity.runOnUiThread {
            activity.requestMediaPermissions()
        }
    }

    @JavascriptInterface
    fun hasStoragePermission(): Boolean {
        return activity.hasPermissions()
    }

    @JavascriptInterface
    fun exitApp() {
        activity.runOnUiThread {
            if (!MusicService.isPlayingStatic) {
                try {
                    activity.stopService(android.content.Intent(activity, MusicService::class.java))
                } catch (e: Exception) {}
                activity.finishAffinity()
            } else {
                activity.moveTaskToBack(true)
            }
        }
    }
}
