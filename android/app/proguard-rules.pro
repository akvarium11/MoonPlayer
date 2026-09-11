# Proguard rules for MoonPlayer
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.moonplayer.app.AndroidBridge { *; }
