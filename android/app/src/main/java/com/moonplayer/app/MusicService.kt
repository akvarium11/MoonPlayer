package com.moonplayer.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import java.net.URL
import kotlin.concurrent.thread

class MusicService : Service() {

    companion object {
        const val CHANNEL_ID = "moonplayer_playback_channel"
        const val NOTIFICATION_ID = 7644

        const val ACTION_PLAY = "com.moonplayer.ACTION_PLAY"
        const val ACTION_PAUSE = "com.moonplayer.ACTION_PAUSE"
        const val ACTION_NEXT = "com.moonplayer.ACTION_NEXT"
        const val ACTION_PREV = "com.moonplayer.ACTION_PREV"
        const val ACTION_STOP = "com.moonplayer.ACTION_STOP"
        const val ACTION_UPDATE = "com.moonplayer.ACTION_UPDATE"
        const val ACTION_LIKE = "com.moonplayer.ACTION_LIKE"

        var mediaListener: MediaActionListener? = null
        var isPlayingStatic = false

        fun updateTrack(
            context: Context,
            title: String,
            artist: String,
            album: String,
            coverUrl: String?,
            isPlaying: Boolean,
            positionMs: Long = 0L,
            durationMs: Long = 0L,
            isLiked: Boolean = false
        ) {
            val intent = Intent(context, MusicService::class.java).apply {
                action = ACTION_UPDATE
                putExtra("title", title)
                putExtra("artist", artist)
                putExtra("album", album)
                putExtra("coverUrl", coverUrl)
                putExtra("isPlaying", isPlaying)
                putExtra("positionMs", positionMs)
                putExtra("durationMs", durationMs)
                putExtra("isLiked", isLiked)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                try {
                    context.startService(intent)
                } catch (e2: Exception) {
                    e2.printStackTrace()
                }
            }
        }
    }

    interface MediaActionListener {
        fun onPlay()
        fun onPause()
        fun onNext()
        fun onPrev()
        fun onSeekTo(posMs: Long)
        fun onLike()
    }

    private var mediaSession: MediaSessionCompat? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var currentTitle = "MoonPlayer"
    private var currentArtist = "No track playing"
    private var currentAlbum = ""
    private var currentCoverUrl: String? = null
    private var isPlaying = false
    private var positionMs: Long = 0L
    private var durationMs: Long = 0L
    private var isLiked: Boolean = false
    private var coverBitmap: Bitmap? = null
    private var defaultLauncherIcon: Bitmap? = null
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val wakeLockReleaseRunnable = Runnable {
        if (!isPlaying) {
            while (wakeLock?.isHeld == true) {
                try { wakeLock?.release() } catch (e: Exception) {}
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        defaultLauncherIcon = try {
            BitmapFactory.decodeResource(resources, R.drawable.ic_launcher)
        } catch (e: Exception) {
            null
        }

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MoonPlayer:WakeLock")

        mediaSession = MediaSessionCompat(this, "MoonPlayerSession").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    isPlaying = true
                    isPlayingStatic = true
                    updateNotification()
                    mediaListener?.onPlay()
                }

                override fun onPause() {
                    isPlaying = false
                    isPlayingStatic = false
                    updateNotification()
                    mediaListener?.onPause()
                }

                override fun onSkipToNext() {
                    mediaListener?.onNext()
                }

                override fun onSkipToPrevious() {
                    mediaListener?.onPrev()
                }

                override fun onSeekTo(pos: Long) {
                    positionMs = pos
                    updateNotification()
                    mediaListener?.onSeekTo(pos)
                }

                override fun onCustomAction(action: String?, extras: Bundle?) {
                    if (action == ACTION_LIKE) {
                        isLiked = !isLiked
                        updateNotification()
                        mediaListener?.onLike()
                    }
                }

                override fun onStop() {
                    stopPlaybackAndSelf()
                }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        when (action) {
            ACTION_PLAY -> {
                isPlaying = true
                isPlayingStatic = true
                updateNotification()
                mediaListener?.onPlay()
            }
            ACTION_PAUSE -> {
                isPlaying = false
                isPlayingStatic = false
                updateNotification()
                mediaListener?.onPause()
            }
            ACTION_NEXT -> mediaListener?.onNext()
            ACTION_PREV -> mediaListener?.onPrev()
            ACTION_LIKE -> {
                isLiked = !isLiked
                mediaListener?.onLike()
                updateNotification()
            }
            ACTION_STOP -> {
                stopPlaybackAndSelf()
            }
            ACTION_UPDATE -> {
                val newTitle = intent.getStringExtra("title") ?: currentTitle
                val newArtist = intent.getStringExtra("artist") ?: currentArtist
                val newAlbum = intent.getStringExtra("album") ?: currentAlbum
                val newPlaying = intent.getBooleanExtra("isPlaying", false)
                val newPos = intent.getLongExtra("positionMs", 0L)
                val newDur = intent.getLongExtra("durationMs", 0L)
                val newLiked = intent.getBooleanExtra("isLiked", false)
                val newCoverUrl = intent.getStringExtra("coverUrl")

                val trackChanged = (newTitle != currentTitle || newArtist != currentArtist || newCoverUrl != currentCoverUrl)
                val stateChanged = (newPlaying != isPlaying)
                val likeChanged = (newLiked != isLiked)
                val seeked = Math.abs(newPos - positionMs) > 2500

                currentTitle = newTitle
                currentArtist = newArtist
                currentAlbum = newAlbum
                isPlaying = newPlaying
                isPlayingStatic = isPlaying
                positionMs = newPos
                durationMs = newDur
                isLiked = newLiked

                if (isPlaying) {
                    mainHandler.removeCallbacks(wakeLockReleaseRunnable)
                    if (wakeLock?.isHeld != true) wakeLock?.acquire(3 * 3600 * 1000L) // 3 hours max
                } else {
                    mainHandler.removeCallbacks(wakeLockReleaseRunnable)
                    mainHandler.postDelayed(wakeLockReleaseRunnable, 60_000L) // 60s buffer for track changes
                }

                if (trackChanged) {
                    currentCoverUrl = newCoverUrl
                    if (!newCoverUrl.isNullOrBlank()) {
                        thread {
                            try {
                                val fullUrl = if (newCoverUrl.startsWith("http")) newCoverUrl else "http://127.0.0.1:7644$newCoverUrl"
                                val conn = URL(fullUrl).openConnection() as java.net.HttpURLConnection
                                conn.connectTimeout = 3000
                                conn.readTimeout = 3000
                                conn.instanceFollowRedirects = true
                                if (conn.responseCode in 200..299) {
                                    conn.inputStream.use { stream ->
                                        coverBitmap = BitmapFactory.decodeStream(stream)
                                    }
                                }
                            } catch (e: Exception) {
                                coverBitmap = null
                            }
                            updateNotification()
                        }
                    } else {
                        coverBitmap = null
                        updateNotification()
                    }
                } else if (stateChanged || likeChanged || seeked) {
                    updateNotification()
                } else {
                    // Routine position tick: smoothly update MediaSession without rebuilding notification
                    updatePlaybackStateOnly()
                }
            }
        }

        return START_NOT_STICKY
    }

    private fun updatePlaybackStateOnly() {
        val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val playbackSpeed = if (isPlaying) 1.0f else 0.0f
        val actions = PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_STOP

        val likeCustomAction = PlaybackStateCompat.CustomAction.Builder(
            ACTION_LIKE,
            if (isLiked) "Liked" else "Like",
            if (isLiked) R.drawable.ic_heart_filled else R.drawable.ic_heart_outline
        ).build()

        val playbackState = PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, positionMs, playbackSpeed, SystemClock.elapsedRealtime())
            .addCustomAction(likeCustomAction)
            .build()
        mediaSession?.setPlaybackState(playbackState)
    }

    private fun updateNotification() {
        val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val playbackSpeed = if (isPlaying) 1.0f else 0.0f
        val actions = PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_STOP

        val likeCustomAction = PlaybackStateCompat.CustomAction.Builder(
            ACTION_LIKE,
            if (isLiked) "Liked" else "Like",
            if (isLiked) R.drawable.ic_heart_filled else R.drawable.ic_heart_outline
        ).build()

        val playbackState = PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, positionMs, playbackSpeed, SystemClock.elapsedRealtime())
            .addCustomAction(likeCustomAction)
            .build()
        mediaSession?.setPlaybackState(playbackState)

        val finalArtwork = coverBitmap ?: defaultLauncherIcon

        val metaBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (durationMs > 0) durationMs else -1L)
        if (finalArtwork != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, finalArtwork)
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, finalArtwork)
        }
        mediaSession?.setMetadata(metaBuilder.build())

        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingOpenApp = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevIntent = PendingIntent.getService(
            this, 1, Intent(this, MusicService::class.java).apply { action = ACTION_PREV },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseAction = if (isPlaying) {
            val pauseIntent = PendingIntent.getService(
                this, 2, Intent(this, MusicService::class.java).apply { action = ACTION_PAUSE },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            NotificationCompat.Action(R.drawable.ic_pause, "Pause", pauseIntent)
        } else {
            val playIntent = PendingIntent.getService(
                this, 2, Intent(this, MusicService::class.java).apply { action = ACTION_PLAY },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            NotificationCompat.Action(R.drawable.ic_play, "Play", playIntent)
        }

        val nextIntent = PendingIntent.getService(
            this, 3, Intent(this, MusicService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val likeIntent = PendingIntent.getService(
            this, 4, Intent(this, MusicService::class.java).apply { action = ACTION_LIKE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val likeIcon = if (isLiked) R.drawable.ic_heart_filled else R.drawable.ic_heart_outline
        val likeTitle = if (isLiked) "Unlike" else "Like"

        val dismissIntent = PendingIntent.getService(
            this, 5, Intent(this, MusicService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum)
            .setLargeIcon(finalArtwork)
            .setContentIntent(pendingOpenApp)
            .setDeleteIntent(dismissIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .addAction(R.drawable.ic_prev, "Previous", prevIntent)
            .addAction(playPauseAction)
            .addAction(R.drawable.ic_next, "Next", nextIntent)
            .addAction(likeIcon, likeTitle, likeIntent)
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        try {
            if (isPlaying) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_DETACH)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(false)
                }
                val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                notificationManager?.notify(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (!isPlaying && !isPlayingStatic && (wakeLock?.isHeld != true)) {
            stopPlaybackAndSelf()
        }
    }

    private fun stopPlaybackAndSelf() {
        isPlaying = false
        isPlayingStatic = false
        mainHandler.removeCallbacks(wakeLockReleaseRunnable)
        while (wakeLock?.isHeld == true) {
            try { wakeLock?.release() } catch (e: Exception) {}
        }
        try {
            mediaSession?.isActive = false
            mediaSession?.release()
            mediaSession = null
        } catch (e: Exception) {}
        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {}
        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            notificationManager?.cancel(NOTIFICATION_ID)
        } catch (e: Exception) {}
        stopSelf()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_description)
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        stopPlaybackAndSelf()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
