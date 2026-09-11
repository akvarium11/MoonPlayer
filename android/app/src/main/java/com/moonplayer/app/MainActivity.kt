package com.moonplayer.app

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var webServer: WebServer? = null
    private lateinit var bridge: AndroidBridge
    private var pauseOnZeroVolumeEnabled = false
    private var wasPausedByZeroVolume = false
    private var volumeReceiver: BroadcastReceiver? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris = if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            when {
                data?.clipData != null -> {
                    val clipData = data.clipData!!
                    Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
                }
                data?.data != null -> {
                    arrayOf(data.data!!)
                }
                else -> null
            }
        } else {
            null
        }
        fileChooserCallback?.onReceiveValue(uris)
        fileChooserCallback = null
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions.entries.all { it.value }
        if (granted) {
            webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onPermissionGranted && window.AndroidBridgeCallbacks.onPermissionGranted();", null)
        } else {
            Toast.makeText(this, "Storage permission is needed to scan your music", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Hardware acceleration flags
        window.setFlags(
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        )

        // System bars styling (solid dark background matching app)
        window.statusBarColor = ContextCompat.getColor(this, R.color.status_bar)
        window.navigationBarColor = ContextCompat.getColor(this, R.color.status_bar)
        androidx.core.view.WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        // Start embedded HTTP server
        try {
            webServer = WebServer(this, WebServer.PORT)
            webServer?.start()
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Setup WebView with native hardware acceleration
        webView = WebView(this).apply {
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.status_bar))
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_DEFAULT
                @Suppress("DEPRECATION")
                setRenderPriority(WebSettings.RenderPriority.HIGH)
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    android.util.Log.d("MoonPlayerWeb", "${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                    return super.onConsoleMessage(consoleMessage)
                }

                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = filePathCallback

                    val intent = try {
                        val chooserIntent = fileChooserParams?.createIntent()
                        if (chooserIntent != null) {
                            chooserIntent
                        } else {
                            Intent(Intent.ACTION_GET_CONTENT).apply {
                                addCategory(Intent.CATEGORY_OPENABLE)
                                type = "image/*"
                            }
                        }
                    } catch (e: Exception) {
                        Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "image/*"
                        }
                    }

                    if (intent.type.isNullOrEmpty() || intent.type == "*/*") {
                        val accept = fileChooserParams?.acceptTypes
                        if (accept != null && accept.isNotEmpty() && accept[0].isNotEmpty()) {
                            intent.type = accept[0]
                        } else {
                            intent.type = "image/*"
                        }
                    }

                    val chooser = Intent.createChooser(intent, "Choose image")
                    return try {
                        fileChooserLauncher.launch(chooser)
                        true
                    } catch (e: Exception) {
                        e.printStackTrace()
                        fileChooserCallback?.onReceiveValue(null)
                        fileChooserCallback = null
                        false
                    }
                }
            }

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    super.onReceivedError(view, request, error)
                    android.util.Log.e("MoonPlayerWeb", "WebView Error: ${error?.description}")
                }
            }
        }

        bridge = AndroidBridge(this)
        webView.addJavascriptInterface(bridge, "AndroidBridge")

        // Hook media actions from MusicService notification/lockscreen
        MusicService.mediaListener = object : MusicService.MediaActionListener {
            override fun onPlay() {
                runOnUiThread {
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onPlay && window.AndroidBridgeCallbacks.onPlay();", null)
                }
            }

            override fun onPause() {
                runOnUiThread {
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onPause && window.AndroidBridgeCallbacks.onPause();", null)
                }
            }

            override fun onNext() {
                runOnUiThread {
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onNext && window.AndroidBridgeCallbacks.onNext();", null)
                }
            }

            override fun onPrev() {
                runOnUiThread {
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onPrev && window.AndroidBridgeCallbacks.onPrev();", null)
                }
            }

            override fun onSeekTo(posMs: Long) {
                runOnUiThread {
                    val sec = posMs / 1000.0
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onSeekTo && window.AndroidBridgeCallbacks.onSeekTo($sec);", null)
                }
            }

            override fun onLike() {
                runOnUiThread {
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onLike && window.AndroidBridgeCallbacks.onLike();", null)
                }
            }
        }

        setContentView(webView)

        // Back button dispatcher
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onBackPressed ? window.AndroidBridgeCallbacks.onBackPressed() : false;") { result ->
                    val handled = result == "true" || result == "\"true\""
                    if (!handled) {
                        // Move to background instead of destroying activity so music continues playing
                        moveTaskToBack(true)
                    }
                }
            }
        })

        // Register volume change observer for auto-pause on mute
        pauseOnZeroVolumeEnabled = getSharedPreferences("moonplayer_prefs", Context.MODE_PRIVATE)
            .getBoolean("pause_on_zero_volume", false)

        val volFilter = IntentFilter("android.media.VOLUME_CHANGED_ACTION")
        volumeReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                checkVolumeState()
            }
        }
        registerReceiver(volumeReceiver, volFilter)

        // Request required permissions
        requestMediaPermissions()

        // Load the app
        webView.loadUrl("http://127.0.0.1:${WebServer.PORT}/index.html")
    }

    fun setPauseOnZeroVolume(enabled: Boolean) {
        pauseOnZeroVolumeEnabled = enabled
        getSharedPreferences("moonplayer_prefs", Context.MODE_PRIVATE)
            .edit().putBoolean("pause_on_zero_volume", enabled).apply()
        checkVolumeState()
    }

    fun getPauseOnZeroVolume(): Boolean = pauseOnZeroVolumeEnabled

    fun checkVolumeState() {
        if (!pauseOnZeroVolumeEnabled) return
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val musicVol = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
        if (musicVol == 0) {
            if (MusicService.isPlayingStatic) {
                wasPausedByZeroVolume = true
                runOnUiThread {
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onPause && window.AndroidBridgeCallbacks.onPause();", null)
                }
            }
        } else if (musicVol > 0) {
            if (wasPausedByZeroVolume) {
                wasPausedByZeroVolume = false
                runOnUiThread {
                    webView.evaluateJavascript("window.AndroidBridgeCallbacks && window.AndroidBridgeCallbacks.onPlay && window.AndroidBridgeCallbacks.onPlay();", null)
                }
            }
        }
    }

    fun hasPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    fun requestMediaPermissions() {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.READ_MEDIA_IMAGES)
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }

        if (permissions.isNotEmpty()) {
            permissionLauncher.launch(permissions.toTypedArray())
        }
    }

    override fun onDestroy() {
        volumeReceiver?.let {
            try { unregisterReceiver(it) } catch (e: Exception) {}
        }
        try {
            webServer?.stop()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        super.onDestroy()
    }
}
