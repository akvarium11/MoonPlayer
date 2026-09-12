<a id="readme-top" name="readme-top"></a>

<div align="center">

<img src="https://files.catbox.moe/blni3p.png" width="120" height="120" alt="MoonPlayer Logo" />

# ✨ MoonPlayer

### *Elevate your local music listening experience.*
A sleek, modern desktop audio player featuring an interactive Dynamic Island, 10-Band Graphic Equalizer, real-time Discord Rich Presence, and audiophile lossless playback.

[![GitHub License](https://img.shields.io/github/license/akvarium11/MoonPlayer?style=for-the-badge&color=7c3aed)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/akvarium11/MoonPlayer?style=for-the-badge&color=eab308)](https://github.com/akvarium11/MoonPlayer/stargazers)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20Android-0078D6?style=for-the-badge&logo=windows)](https://github.com/akvarium11/MoonPlayer)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app)
[![Android](https://img.shields.io/badge/Android-Companion%20App-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/akvarium11/MoonPlayer/releases/latest)
[![Node.js](https://img.shields.io/badge/Node.js-Express%205-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Discord RPC](https://img.shields.io/badge/Discord-Rich%20Presence-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com)

---

### [ 🌐 Read in English ](#english) &nbsp;&nbsp;•&nbsp;&nbsp; [ 🇷🇺 Читать на русском ](#russian)

---

</div>

<br/>

# <a id="english" name="english"></a><a id="header-en" name="header-en"></a>🇺🇸 English

> **Quick Navigation:**  
> [ 📸 Screenshots ](#screenshots-en) &nbsp;•&nbsp; [ 🌟 Features ](#features-en) &nbsp;•&nbsp; [ 🏗️ Architecture ](#architecture-en) &nbsp;•&nbsp; [ 🚀 Installation ](#installation-en) &nbsp;•&nbsp; [ 📖 How to Use ](#usage-en) &nbsp;•&nbsp; [ 🇷🇺 Перейти на русский ](#russian)

---

## <a id="screenshots-en" name="screenshots-en"></a>📸 Screenshots Showcase

<div align="center">

### 🌌 Main Library & Album Explorer
*Dark glassmorphic UI, artist list, fuzzy search, and clean lossless FLAC badges.*
<br/>
<img src="https://files.catbox.moe/n8mnpw.png" alt="MoonPlayer Main Interface" width="95%" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" />

<br/><br/>

### ☁️ SoundCloud Streaming, Wave & Unified Discovery
*Search and stream tracks, full playlists, albums, and artist discographies directly from SoundCloud with automatic similar track Wave stations and lossless UI.*
<br/>
<img src="https://files.catbox.moe/sd5f97.png" alt="MoonPlayer SoundCloud Showcase" width="95%" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" />

<br/><br/>

### 🏝️ Interactive Dynamic Island (Expanded View)
*Floating Dynamic Island with spinning vinyl turntable, real-time audio spectrum visualizer, synced lyrics, and queue.*
<br/>
<img src="https://files.catbox.moe/b8wvng.png" alt="MoonPlayer Dynamic Island" width="95%" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" />

<br/><br/>

### 📱 Android Mobile Companion App
*Mobile-optimized interface featuring a floating Dynamic Island, background playback service with lock screen MediaSession controls, local storage library scanner, and touch-adapted navigation.*
<br/>
<img src="https://raw.githubusercontent.com/akvarium11/MoonPlayer/main/assets/preview_mobile.jpg" alt="MoonPlayer Android App" width="380" style="border-radius: 24px; border: 4px solid rgba(255,255,255,0.1); box-shadow: 0 16px 40px rgba(0,0,0,0.7);" />

</div>

<br/>

---

## <a id="features-en" name="features-en"></a>🌟 Key Features

| Feature | Description |
| :--- | :--- |
| ☁️ **SoundCloud Streaming & Discovery** | Seamless ad-free streaming via SoundCloud API v2. Explore your personal likes and playlists, browse full artist discographies, listen to algorithmic Wave stations of similar tracks, and download tracks with ID3 tags directly into your local library. |
| 🏝️ **Floating Dynamic Island** | Responsive capsule floating at the top. Expands into a full-featured player with spinning vinyl animation, live audio visualizer, timeline scrub, lyrics switcher, and queue drawer. Compact mode displays mini-waveforms and track info. |
| 📱 **Android Companion App** | Official **MoonPlayer.apk** for Android 7.0+ (API 24–34). Features foreground background audio service, notification drawer & lock screen controls (MediaSession API), hardware volume key support, local device music scanner, and touch-optimized Dynamic Island navigation. |
| 🎚️ **10-Band ISO Equalizer** | Studio-grade Web Audio API equalizer covering standard ISO frequencies (`32Hz` to `16kHz`). Features Preamp gain control (`-12dB` to `+12dB`), live spline curve (АЧХ) canvas, 10 crafted presets, and custom preset saving. |
| 💎 **Lossless & Multi-Format** | First-class support for **FLAC Lossless** audio with an elegant `[F]` vector badge, plus `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.opus`, and `.webm`. |
| 🎮 **Discord Rich Presence** | Automatically updates your Discord status with current track title, artist, album name, elapsed & remaining playback time, pause detection, and dynamic high-res album covers via Deezer, iTunes, and Last.fm. |
| 🔍 **Smart Fuzzy Search** | Typo-tolerant, instantaneous search powered by **Fuse.js**. Quickly search across songs, artists, and albums without missing a beat. |
| ⚡ **IndexedDB Metadata Engine** | Scans massive local music libraries in seconds. Caches parsed ID3 tags and album artwork in the browser's IndexedDB for zero-lag subsequent launches. |
| 🎨 **Aesthetic Customization** | Vibrant accent presets (Neon Green, Pink, Electric Blue, Purple, Sunset Orange, Minimalist White) plus a custom color picker. Upload your own wallpapers with customizable blur and opacity. |
| 📜 **Synchronized Lyrics (.lrc)** | Real-time karaoke-style lyrics display synced directly with playback inside the expanded island. |
| ⏱️ **Sleep Timer** | Built-in shutdown countdown timers (15, 30, 45, 60 minutes) to gently pause your music when heading to sleep. |
| 🪟 **Tauri v2 Native Architecture** | Powered by ultra-lightweight **Tauri v2** & Rust desktop shell with Edge WebView2 on Windows and WebKit2GTK on Linux, replacing heavy Electron with instant launch, minimal RAM, and native OS integration. |

---

## <a id="architecture-en" name="architecture-en"></a>🏗️ Architecture

```
┌───────────────────────────────────────────────┬───────────────────────────────────────────────┐
│           Desktop Shell / Launcher            │               Android Companion               │
│   • Tauri v2 Standalone (src-tauri Rust)      │   • Native Android APK (API 24–34)            │
│   • C++ Native Wrapper (WebView2 / WebKitGTK) │   • Android AudioService & MediaSession       │
└───────────────────────┬───────────────────────┴───────────────────────┬───────────────────────┘
                        │                                               │
                        ▼                                               ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                               Frontend UI (HTML5 / CSS3 / ES6+)                               │
│   • Dynamic Island (Compact Capsule & Expanded Vinyl Turntable)                               │
│   • Web Audio API 10-Band Equalizer & Visualizer Spectrum Canvas                              │
│   • IndexedDB Metadata & Artwork Caching                                                      │
│   • Fuse.js Typo-Tolerant Search & .LRC Lyrics Parser                                         │
│   • Touch Gestures & Responsive Mobile Viewport Overlays                                      │
└───────────────────────▲───────────────────────────────────────────────▲───────────────────────┘
                        │                                               │
                        ▼                                               ▼
┌───────────────────────────────────────────────┐ ┌─────────────────────────────────────────────┐
│      Backend Service (Node.js + Express)      │ │          Android System Framework           │
│   • Local Directory Scanner & File Watcher    │ │   • MediaSession & Foreground Service       │
│   • Discord RPC Client (discord_presence.js)  │ │   • Native Storage Access (MediaStore API)  │
│   • High-Res Artwork Resolver (Deezer, etc.)  │ │   • Hardware Volume & Headset Hook Events   │
│   • Persistent JSON Settings                  │ │   • Zero-Lag Hardware Accelerated WebView   │
└───────────────────────────────────────────────┘ └─────────────────────────────────────────────┘
```

---

## <a id="installation-en" name="installation-en"></a>🚀 Quick Start & Installation

### Option 1: Standalone Desktop App (Recommended for Windows)
No runtime dependencies or Node.js required on user PCs:
- **Installer**: Download **`MoonPlayer_2.5.0_x64-setup.exe`** from [Latest Release](https://github.com/akvarium11/MoonPlayer/releases/latest) for automatic installation with Start Menu and Desktop shortcuts.
- **Portable**: Download **`MoonPlayer_2.5.0_portable.zip`**, extract anywhere, and launch `moonplayer.exe`.

---

### Option 2: 📱 Android Mobile Companion App
Take your music and SoundCloud streaming anywhere on your smartphone:
1. Download **`MoonPlayer.apk`** from [Latest Release](https://github.com/akvarium11/MoonPlayer/releases/latest).
2. Install the APK on your Android device (Android 7.0+ / API 24–34).
3. Grant audio storage access when prompted to automatically scan your device's music files.
4. Enjoy continuous background playback, lock screen media controls, and the touch-adapted Dynamic Island!

---

### Option 3: Running from Source (Developers)

#### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- [npm](https://www.npmjs.com/)

#### Setup
```bash
# 1. Clone the repository
git clone https://github.com/akvarium11/MoonPlayer.git

# 2. Navigate to project root
cd MoonPlayer

# 3. Install dependencies
npm install

# 4. Start the application
npm start
```

#### Build Standalone Executables (Tauri v2)
```bash
# Build standalone desktop binary with Tauri
npm run build
# or
npm run tauri:build
```

---

### Option 4: Lightweight Native C++ Launcher (WebView2 / WebKitGTK)

<details>
<summary><b>Click to expand C++ compilation instructions</b></summary>

#### 🪟 Windows (MinGW / GCC)
Make sure you have MinGW with `g++` and `windres` installed:
```cmd
# 1. Compile Windows resource icon
windres resources.rc -o resources.o

# 2. Compile launcher binary
g++ -std=c++17 launcher.cpp resources.o -o MoonPlayer.exe -Iwebview2_sdk/build/native/include -lws2_32 -lole32 -lversion -lshlwapi -luuid -luser32 -lgdi32 -ldwmapi -mwindows -municode

# 3. Clean up object file
del resources.o
```

#### 🐧 Linux (GTK3 / WebKit2GTK)
Install developer headers:
- **Ubuntu/Debian**: `sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev`
- **Fedora**: `sudo dnf install gcc-c++ gtk3-devel webkit2gtk3-devel`
- **Arch Linux**: `sudo pacman -S gcc gtk3 webkit2gtk`

Compile launcher:
```bash
chmod +x build_linux.sh
./build_linux.sh
```
</details>

---

## <a id="usage-en" name="usage-en"></a>📖 How to Use

1. **Launch MoonPlayer** via the executable.
2. Click the **Settings** icon (⚙️) in the top-right corner.
3. In **Server Music Folders**, enter the absolute path to your local music directory (e.g. `D:\Music` or `/home/user/Music`) and click **ADD**.
4. Close settings. MoonPlayer will automatically index your songs, fetch artwork, and populate your library.
5. Click on any track or album to start playing. Click the **Dynamic Island** at the top to expand the player, switch lyrics, adjust the equalizer, or view your queue!

<br/>

### ☁️ Connecting SoundCloud (How to get your OAuth Token)

MoonPlayer integrates directly with SoundCloud to let you search, stream, generate Wave stations of similar tracks, and download music without third-party ads.

1. Open MoonPlayer **Settings** (⚙️).
2. Enable the **SoundCloud** toggle.
3. Obtain your personal `oauth_token`:
   - In any web browser (Chrome, Edge, Firefox), navigate to [soundcloud.com](https://soundcloud.com) and log in to your account.
   - Press <kbd>F12</kbd> (or right-click -> *Inspect*) to open Developer Tools.
   - Go to the **Application** tab (or **Storage** in Firefox) -> Expand **Cookies** -> Select `https://soundcloud.com`.
   - In the cookie list, search for `oauth_token`.
   - Copy the cookie value (starts with `2-` e.g., `2-325...`).
4. Paste the token into the **OAuth Token** field in MoonPlayer Settings and click **SAVE**.
5. Once connected, your username and avatar will appear with a green status indicator. You can now browse your personal likes, created playlists, search tracks/artists/albums, launch "Wave" stations on any song, or download songs directly to your library!

<br/>

### 📱 Using MoonPlayer on Android

1. **Install and Open**: Launch **MoonPlayer.apk** on your Android device.
2. **Instant Local Scan**: Grant audio/media access on startup. The app automatically indexes all songs and folders on your device or SD card (`.flac`, `.mp3`, `.wav`, `.m4a`, `.ogg`, `.opus`) without needing any desktop server.
3. **SoundCloud on Mobile**: Enter Settings (⚙️), paste your SoundCloud OAuth token, and your likes, playlists, and algorithmic Wave recommendations become immediately accessible on your phone.
4. **Dynamic Island & Gestures**: Tap the top floating capsule to open the vinyl player, queue, or lyrics. Swipe down to dismiss smoothly.
5. **Background Service & Lock Screen**: MoonPlayer runs a persistent Android Foreground AudioService with native `MediaSession` integration. Control playback, skip tracks, and view album art directly from your lock screen, notification center, or Bluetooth headset buttons.

---

## ⌨️ Keyboard Shortcuts & Controls

| Action | Control / Shortcut |
| :--- | :--- |
| **Play / Pause** | `Space` / Island Play Button |
| **Next Track** | `Ctrl + Right` / Next Button |
| **Previous Track** | `Ctrl + Left` / Prev Button |
| **Expand / Collapse Island** | Click top capsule / Island header |
| **Volume Control** | `Mouse Wheel` over volume slider or player |
| **Pin Island Open** | Click Pin icon (📌) in expanded island |
| **Toggle Lyrics** | Click Music Note icon (🎵) in expanded island |
| **Toggle Queue** | Click Queue icon (📑) in expanded island |

---

## <a id="license-en" name="license-en"></a>📄 License

This project is licensed under the **GPL-3.0 License** — see the [LICENSE](LICENSE) file for details.

<div align="right">

[ ↑ Back to Top ](#readme-top) &nbsp;•&nbsp; [ 🇷🇺 Читать на русском ](#russian)

</div>

---
<br/>

# <a id="russian" name="russian"></a><a id="header-rus" name="header-rus"></a>🇷🇺 Русский

> **Быстрая навигация:**  
> [ 📸 Скриншоты ](#screenshots-ru) &nbsp;•&nbsp; [ 🌟 Возможности ](#features-ru) &nbsp;•&nbsp; [ 🏗️ Архитектура ](#architecture-ru) &nbsp;•&nbsp; [ 🚀 Установка ](#installation-ru) &nbsp;•&nbsp; [ 📖 Как пользоваться ](#usage-ru) &nbsp;•&nbsp; [ 🌐 Switch to English ](#english)

---

## <a id="screenshots-ru" name="screenshots-ru"></a>📸 Галерея скриншотов

<div align="center">

### 🌌 Главная библиотека и альбомный навигатор
*Темная нео-глассморфик тема, список исполнителей, умный нечеткий поиск и бейджи FLAC без потерь.*
<br/>
<img src="https://files.catbox.moe/n8mnpw.png" alt="Главный интерфейс MoonPlayer" width="95%" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" />

<br/><br/>

### ☁️ Интеграция с SoundCloud, умная Волна и профили артистов
*Полноценный стриминг, доступ к своим лайкам и плейлистам, поиск альбомов и дискографий, автогенерация «Волны» похожих треков и скачивание в коллекцию.*
<br/>
<img src="https://files.catbox.moe/sd5f97.png" alt="Интеграция SoundCloud в MoonPlayer" width="95%" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" />

<br/><br/>

### 🏝️ Интерактивный Dynamic Island (Раскрытый режим)
*Плавающий остров с анимацией вращающейся виниловой пластинки, живым спектральным визуализатором, синхронизированными текстами и очередью.*
<br/>
<img src="https://files.catbox.moe/b8wvng.png" alt="Dynamic Island MoonPlayer" width="95%" style="border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" />

<br/><br/>

### 📱 Мобильная версия для Android
*Адаптированный под сенсорные экраны интерфейс с плавающим Dynamic Island, фоновым сервисом воспроизведения с уведомлением в шторке/на экране блокировки и сканером локальной музыки устройства.*
<br/>
<img src="https://raw.githubusercontent.com/akvarium11/MoonPlayer/main/assets/preview_mobile.jpg" alt="Интерфейс MoonPlayer для Android" width="380" style="border-radius: 24px; border: 4px solid rgba(255,255,255,0.1); box-shadow: 0 16px 40px rgba(0,0,0,0.7);" />

</div>

<br/>

---

## <a id="features-ru" name="features-ru"></a>🌟 Ключевые возможности

| Возможность | Описание |
| :--- | :--- |
| ☁️ **SoundCloud и умная Волна** | Бесшовный стриминг музыки без рекламы. Доступ к вашим лайкам и плейлистам, навигация по дискографиям исполнителей, автоматическая «Волна» с подбором похожих треков и скачивание в локальную коллекцию с ID3v2 тегами и обложками $500\times500$. |
| 🏝️ **Интерактивный Dynamic Island** | Плавающий «остров» в верхней части экрана. Плавно разворачивается в полноценный аудиоплеер с анимированным винилом, спектрограммой, таймлайном, текстами песен и очередью воспроизведения. В компактном виде отображает мини-волну и текущий трек. |
| 📱 **Мобильная версия для Android** | Официальный клиент **MoonPlayer.apk** для Android 7.0+ (API 24–34). Фоновое воспроизведение через Foreground Service, управление в шторке и на экране блокировки (MediaSession API), аппаратные кнопки громкости, сканирование треков из памяти телефона и жестовый Dynamic Island. |
| 🎚️ **10-полосный ISO эквалайзер** | Студийный эквалайзер на Web Audio API по стандарту ISO (`32 Гц` — `16 кГц`). Регулировка предусиления Preamp (`от -12 дБ до +12 дБ`), живой график АЧХ (частотной характеристики), 10 готовых пресетов и сохранение собственных настроек. |
| 💎 **Lossless и все форматы** | Полноценная поддержка **FLAC** с аккуратным векторным бейджем `[F]`, а также `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.opus` и `.webm`. |
| 🎮 **Discord Rich Presence** | Отображение статуса в Discord: название трека, исполнитель, альбом, прогресс воспроизведения, статус паузы и автоматическая подгрузка HD-обложек через Deezer, iTunes и Last.fm. |
| 🔍 **Умный нечеткий поиск** | Мгновенный поиск на базе **Fuse.js**, устойчивый к опечаткам. Ищите треки, исполнителей и альбомы на лету. |
| ⚡ **Кэширование метаданных в IndexedDB** | Мгновенный запуск и сканирование огромных коллекций. Вся информация об аудио и обложки сохраняются в IndexedDB браузера без повторных задержек. |
| 🎨 **Глубокая кастомизация** | Готовые неоновые цветовые темы (зеленый, розовый, голубой, фиолетовый, оранжевый, белый) и палитра для любого цвета. Возможность загрузки своего фонового изображения с регулировкой блюра и прозрачности. |
| 📜 **Синхронизация текстов (.lrc)** | Построчное отображение караоке-текстов песен в реальном времени прямо внутри Dynamic Island. |
| ⏱️ **Таймер сна** | Встроенный таймер автоотключения на 15, 30, 45 или 60 минут. |
| 🪟 **Нативная архитектура Tauri v2** | Работает на ультра-легковесной десктопной оболочке **Tauri v2** и Rust (WebView2 на Windows / WebKitGTK на Linux) вместо тяжелого Electron — мгновенный старт, минимум RAM и глубокая системная интеграция. |

---

## <a id="architecture-ru" name="architecture-ru"></a>🏗️ Архитектура

```
┌───────────────────────────────────────────────┬───────────────────────────────────────────────┐
│         Десктопная оболочка / Лаунчер         │              Мобильный компаньон              │
│   • Автономный Tauri v2 (src-tauri на Rust)   │   • Нативное Android APK (API 24–34)          │
│   • Нативный C++ лаунчер (WebView2/WebKitGTK) │   • Фоновый AudioService и MediaSession       │
└───────────────────────┬───────────────────────┴───────────────────────┬───────────────────────┘
                        │                                               │
                        ▼                                               ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Клиентский UI (HTML5 / CSS3 / ES6+)                              │
│   • Dynamic Island (Компактная капсула и раскрытый виниловый плеер)                           │
│   • 10-полосный эквалайзер Web Audio API & Canvas визуализатор                                │
│   • Кэширование тегов и обложек в IndexedDB                                                   │
│   • Нечеткий поиск Fuse.js & парсер синхронизированных .LRC текстов                           │
│   • Сенсорная оптимизация и поддержка жестов на мобильных экранах                             │
└───────────────────────▲───────────────────────────────────────────────▲───────────────────────┘
                        │                                               │
                        ▼                                               ▼
┌───────────────────────────────────────────────┐ ┌─────────────────────────────────────────────┐
│       Бэкенд сервис (Node.js + Express)       │ │            Система Android (OS)             │
│   • Сканирование файловой системы и вотчер    │ │   • MediaSession и Foreground Service       │
│   • Клиент Discord RPC (discord_presence.js)  │ │   • Чтение треков устройства (MediaStore)   │
│   • Резолвер обложек (Deezer, iTunes, Last.fm)│ │   • Аппаратные кнопки громкости и гарнитур  │
│   • Хранение конфигурации JSON                │ │   • Аппаратно-ускоренный системный WebView  │
└───────────────────────────────────────────────┘ └─────────────────────────────────────────────┘
```

---

## <a id="installation-ru" name="installation-ru"></a>🚀 Быстрый старт и установка

### Вариант 1: Десктопная версия для Windows (Рекомендуется)
Не требует установки Node.js, Python или дополнительных программ:
- **Установщик**: Скачайте **`MoonPlayer_2.5.0_x64-setup.exe`** из раздела [Releases](https://github.com/akvarium11/MoonPlayer/releases/latest) для быстрой установки с ярлыками в меню «Пуск» и на рабочем столе.
- **Портативная версия**: Скачайте архив **`MoonPlayer_2.5.0_portable.zip`**, распакуйте в любую папку и запустите `moonplayer.exe`.

---

### Вариант 2: 📱 Мобильное приложение для Android
Слушайте треки с устройства и SoundCloud прямо на телефоне:
1. Скачайте **`MoonPlayer.apk`** из раздела [Releases](https://github.com/akvarium11/MoonPlayer/releases/latest).
2. Установите APK на ваш смартфон (поддерживается Android 7.0+ / API 24–34).
3. Разрешите доступ к аудиофайлам при первом запуске — плеер мгновенно просканирует музыку на устройстве и SD-карте.
4. Пользуйтесь непрерывным фоновым воспроизведением с удобным плеером в шторке уведомлений и на экране блокировки!

---

### Вариант 3: Запуск из исходного кода (Для разработчиков)

#### Требования
- Установленный [Node.js](https://nodejs.org/) (версия 18 или новее)
- Менеджер пакетов [npm](https://www.npmjs.com/)

#### Инструкция
```bash
# 1. Клонируйте репозиторий
git clone https://github.com/akvarium11/MoonPlayer.git

# 2. Перейдите в папку проекта
cd MoonPlayer

# 3. Установите зависимости
npm install

# 4. Запустите приложение
npm start
```

#### Сборка автономного бинарника (Tauri v2)
```bash
# Сборка нативного десктопного бинарника через Tauri
npm run build
# или
npm run tauri:build
```

---

### Вариант 4: Сборка нативного C++ лаунчера (WebView2 / WebKitGTK)

<details>
<summary><b>Нажмите, чтобы развернуть инструкции по компиляции C++</b></summary>

#### 🪟 Windows (MinGW / GCC)
Убедитесь, что у вас установлен MinGW с утилитами `g++` и `windres`:
```cmd
# 1. Компиляция файла ресурсов и иконки
windres resources.rc -o resources.o

# 2. Сборка исполняемого файла
g++ -std=c++17 launcher.cpp resources.o -o MoonPlayer.exe -Iwebview2_sdk/build/native/include -lws2_32 -lole32 -lversion -lshlwapi -luuid -luser32 -lgdi32 -ldwmapi -mwindows -municode

# 3. Удаление временного файла объекта
del resources.o
```

#### 🐧 Linux (GTK3 / WebKit2GTK)
Установите библиотеки для разработки:
- **Ubuntu/Debian**: `sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev`
- **Fedora**: `sudo dnf install gcc-c++ gtk3-devel webkit2gtk3-devel`
- **Arch Linux**: `sudo pacman -S gcc gtk3 webkit2gtk`

Сборка через скрипт:
```bash
chmod +x build_linux.sh
./build_linux.sh
```
</details>

---

## <a id="usage-ru" name="usage-ru"></a>📖 Как пользоваться

1. **Запустите MoonPlayer** (через `.exe` или `npm start`).
2. Нажмите на иконку настроек (⚙️) в правом верхнем углу.
3. В поле **Server Music Folders** укажите абсолютный путь к папке с музыкой (например, `D:\Music` или `/home/user/Music`) и нажмите **ADD**.
4. Закройте настройки. Плеер автоматически проиндексирует треки, подтянет метаданные и обложки.
5. Нажмите на любой трек для воспроизведения. Нажмите на **Dynamic Island** вверху экрана, чтобы открыть расширенную панель, включить текст песни, настроить эквалайзер или изменить очередь!

<br/>

### 📱 Использование MoonPlayer на Android

1. **Установка и первый запуск**: Установите и запустите **MoonPlayer.apk** на Android-смартфоне.
2. **Мгновенное сканирование**: При первом запуске разрешите доступ к аудиофайлам — приложение автоматически просканирует и отобразит всю музыку из памяти телефона и SD-карты (`.flac`, `.mp3`, `.wav`, `.m4a`, `.ogg`, `.opus`) без необходимости подключения к ПК.
3. **SoundCloud на смартфоне**: Перейдите в Настройки (⚙️), вставьте ваш токен SoundCloud — и ваши плейлисты, лайки и рекомендации «Волны» будут всегда с вами.
4. **Dynamic Island и жесты**: Нажимайте на плавающую капсулу сверху для открытия плеера с винилом, текстов песен или очереди воспроизведения.
5. **Фоновый режим и экран блокировки**: Благодаря системному Foreground AudioService и поддержке `MediaSession`, музыка воспроизводится непрерывно в фоне, а управлять треками, переключать паузу и смотреть обложки можно прямо из шторки уведомлений и экрана блокировки.

<br/>

### ☁️ Подключение SoundCloud (Как получить OAuth Token)

MoonPlayer позволяет искать, слушать онлайн, запускать «Волну» рекомендаций и скачивать треки прямо из SoundCloud без рекламы.

1. Откройте **Настройки** (⚙️ в правом верхнем углу).
2. Включите тумблер **SoundCloud**.
3. Получите ваш персональный `oauth_token`:
   - В любом браузере откройте [soundcloud.com](https://soundcloud.com) и войдите в свой аккаунт.
   - Нажмите клавишу <kbd>F12</kbd> (или правой кнопкой мыши -> *Просмотреть код*), чтобы открыть Инструменты разработчика (DevTools).
   - Перейдите во вкладку **Application** (в Firefox — **Хранилище / Storage**) -> раскройте слева раздел **Cookies** -> выберите `https://soundcloud.com`.
   - Найдите в списке cookie с именем `oauth_token`.
   - Скопируйте его значение (начинается на `2-`, например `2-325...`).
4. Вставьте скопированный токен в поле **OAuth Token** в настройках MoonPlayer и нажмите **SAVE**.
5. Плеер подключится к вашему профилю (появится ваш никнейм и зеленый индикатор). Теперь во вкладке SoundCloud вам доступны ваши плейлисты, любимые треки, запуск «Волны» с похожей музыкой и скачивание треков!

---

## ⌨️ Управление и горячие клавиши

| Действие | Клавиша / Элемент управления |
| :--- | :--- |
| **Пауза / Воспроизведение** | `Пробел` / Кнопка Play в Dynamic Island |
| **Следующий трек** | `Ctrl + Вправо` / Кнопка Next |
| **Предыдущий трек** | `Ctrl + Влево` / Кнопка Prev |
| **Открыть / Закрыть Dynamic Island** | Клик по верхней капсуле |
| **Регулировка громкости** | `Колесико мыши` над слайдером громкости |
| **Закрепить остров открытым** | Кнопка закрепления (📌) в Dynamic Island |
| **Текст песни (Lyrics)** | Кнопка с нотой (🎵) в Dynamic Island |
| **Очередь воспроизведения** | Кнопка списка (📑) в Dynamic Island |

---

## <a id="license-ru" name="license-ru"></a>📄 Лицензия

Проект распространяется под свободной лицензией **GPL-3.0 License** — подробности в файле [LICENSE](LICENSE).

<div align="right">

[ ↑ Наверх ](#readme-top) &nbsp;•&nbsp; [ 🌐 Switch to English ](#english)

</div>

<div align="center">

---

**Made with 💜 by [akvarium11](https://github.com/akvarium11)**  
*MoonPlayer — слушайте любимую музыку красиво.*

</div>
