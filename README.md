<a id="readme-top" name="readme-top"></a>

<div align="center">

<img src="https://files.catbox.moe/blni3p.png" width="120" height="120" alt="MoonPlayer Logo" />

# ✨ MoonPlayer

### *Elevate your local music listening experience.*
A sleek, modern desktop audio player featuring an interactive Dynamic Island, 10-Band Graphic Equalizer, real-time Discord Rich Presence, and audiophile lossless playback.

[![GitHub License](https://img.shields.io/github/license/akvarium11/MoonPlayer?style=for-the-badge&color=7c3aed)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/akvarium11/MoonPlayer?style=for-the-badge&color=eab308)](https://github.com/akvarium11/MoonPlayer/stargazers)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-0078D6?style=for-the-badge&logo=windows)](https://github.com/akvarium11/MoonPlayer)
[![Electron](https://img.shields.io/badge/Electron-44.1.1-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://electronjs.org)
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

</div>

<br/>

---

## <a id="features-en" name="features-en"></a>🌟 Key Features

| Feature | Description |
| :--- | :--- |
| ☁️ **SoundCloud Streaming & Discovery** | Seamless ad-free streaming via SoundCloud API v2. Explore your personal likes and playlists, browse full artist discographies, listen to algorithmic Wave stations of similar tracks, and download tracks with ID3 tags directly into your local library. |
| 🏝️ **Floating Dynamic Island** | Responsive capsule floating at the top. Expands into a full-featured player with spinning vinyl animation, live audio visualizer, timeline scrub, lyrics switcher, and queue drawer. Compact mode displays mini-waveforms and track info. |
| 🎚️ **10-Band ISO Equalizer** | Studio-grade Web Audio API equalizer covering standard ISO frequencies (`32Hz` to `16kHz`). Features Preamp gain control (`-12dB` to `+12dB`), live spline curve (АЧХ) canvas, 10 crafted presets, and custom preset saving. |
| 💎 **Lossless & Multi-Format** | First-class support for **FLAC Lossless** audio with an elegant `[F]` vector badge, plus `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.opus`, and `.webm`. |
| 🎮 **Discord Rich Presence** | Automatically updates your Discord status with current track title, artist, album name, elapsed & remaining playback time, pause detection, and dynamic high-res album covers via Deezer, iTunes, and Last.fm. |
| 🔍 **Smart Fuzzy Search** | Typo-tolerant, instantaneous search powered by **Fuse.js**. Quickly search across songs, artists, and albums without missing a beat. |
| ⚡ **IndexedDB Metadata Engine** | Scans massive local music libraries in seconds. Caches parsed ID3 tags and album artwork in the browser's IndexedDB for zero-lag subsequent launches. |
| 🎨 **Aesthetic Customization** | Vibrant accent presets (Neon Green, Pink, Electric Blue, Purple, Sunset Orange, Minimalist White) plus a custom color picker. Upload your own wallpapers with customizable blur and opacity. |
| 📜 **Synchronized Lyrics (.lrc)** | Real-time karaoke-style lyrics display synced directly with playback inside the expanded island. |
| ⏱️ **Sleep Timer** | Built-in shutdown countdown timers (15, 30, 45, 60 minutes) to gently pause your music when heading to sleep. |
| 🪟 **Dual Engine Architecture** | Run as a standalone portable Electron app, or use the ultra-lightweight native C++ launcher (`launcher.cpp`) with Edge WebView2 on Windows and WebKit2GTK on Linux. |

---

## <a id="architecture-en" name="architecture-en"></a>🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Desktop Shell / Launcher                        │
│   • Electron Standalone (dist/MoonPlayer.exe)                          │
│   • OR Native C++ Wrapper (launcher.cpp + WebView2 / WebKitGTK)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Embeds Web Engine
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    Frontend UI (HTML5 / CSS3 / ES6+)                   │
│   • Dynamic Island (Compact Capsule & Expanded Vinyl Turntable)        │
│   • Web Audio API 10-Band Equalizer & Visualizer Spectrum Canvas       │
│   • IndexedDB Metadata & Artwork Caching                               │
│   • Fuse.js Typo-Tolerant Search & .LRC Lyrics Parser                  │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ REST API & Audio Streaming (/api/stream)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Backend Service (Node.js + Express)                   │
│   • Local Directory Scanner & File Watcher                             │
│   • Discord RPC Client (discord_presence.js)                           │
│   • High-Res Artwork Resolver (Deezer, iTunes, Last.fm)                │
│   • Persistent Settings (music_folders.json, cover_cache.json)         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## <a id="installation-en" name="installation-en"></a>🚀 Quick Start & Installation

### Option 1: Standalone Portable Binary (Recommended for Users)
No runtime dependencies, Node.js, or complex compilation required:
1. Download **`MoonPlayer.exe`** from [Releases](https://github.com/akvarium11/MoonPlayer/releases).
2. Launch `MoonPlayer.exe` and enjoy your music right away!

---

### Option 2: Running from Source (Developers)

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

#### Build Standalone Executables
```bash
# Build standalone portable Windows x64 binary (dist/MoonPlayer.exe)
npm run build

# Build NSIS Windows installer
npm run build:installer
```

---

### Option 3: Lightweight Native C++ Launcher (WebView2 / WebKitGTK)

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

</div>

<br/>

---

## <a id="features-ru" name="features-ru"></a>🌟 Ключевые возможности

| Возможность | Описание |
| :--- | :--- |
| ☁️ **SoundCloud и умная Волна** | Бесшовный стриминг музыки без рекламы. Доступ к вашим лайкам и плейлистам, навигация по дискографиям исполнителей, автоматическая «Волна» с подбором похожих треков и скачивание в локальную коллекцию с ID3v2 тегами и обложками $500\times500$. |
| 🏝️ **Интерактивный Dynamic Island** | Плавающий «остров» в верхней части экрана. Плавно разворачивается в полноценный аудиоплеер с анимированным винилом, спектрограммой, таймлайном, текстами песен и очередью воспроизведения. В компактном виде отображает мини-волну и текущий трек. |
| 🎚️ **10-полосный ISO эквалайзер** | Студийный эквалайзер на Web Audio API по стандарту ISO (`32 Гц` — `16 кГц`). Регулировка предусиления Preamp (`от -12 дБ до +12 дБ`), живой график АЧХ (частотной характеристики), 10 готовых пресетов и сохранение собственных настроек. |
| 💎 **Lossless и все форматы** | Полноценная поддержка **FLAC** с аккуратным векторным бейджем `[F]`, а также `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.opus` и `.webm`. |
| 🎮 **Discord Rich Presence** | Отображение статуса в Discord: название трека, исполнитель, альбом, прогресс воспроизведения, статус паузы и автоматическая подгрузка HD-обложек через Deezer, iTunes и Last.fm. |
| 🔍 **Умный нечеткий поиск** | Мгновенный поиск на базе **Fuse.js**, устойчивый к опечаткам. Ищите треки, исполнителей и альбомы на лету. |
| ⚡ **Кэширование метаданных в IndexedDB** | Мгновенный запуск и сканирование огромных коллекций. Вся информация об аудио и обложки сохраняются в IndexedDB браузера без повторных задержек. |
| 🎨 **Глубокая кастомизация** | Готовые неоновые цветовые темы (зеленый, розовый, голубой, фиолетовый, оранжевый, белый) и палитра для любого цвета. Возможность загрузки своего фонового изображения с регулировкой блюра и прозрачности. |
| 📜 **Синхронизация текстов (.lrc)** | Построчное отображение караоке-текстов песен в реальном времени прямо внутри Dynamic Island. |
| ⏱️ **Таймер сна** | Встроенный таймер автоотключения на 15, 30, 45 или 60 минут. |
| 🪟 **Двойной движок** | Работает как полностью автономный переносимый файл (Electron), так и через нативный легковесный C++ лаунчер (`launcher.cpp` на WebView2 / WebKitGTK). |

---

## <a id="architecture-ru" name="architecture-ru"></a>🏗️ Архитектура

```
┌────────────────────────────────────────────────────────────────────────┐
│                     Десктопная оболочка / Лаунчер                      │
│   • Автономный Electron (dist/MoonPlayer.exe)                          │
│   • ИЛИ Нативный C++ лаунчер (launcher.cpp + WebView2 / WebKitGTK)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Встраивает WebView
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Клиентский UI (HTML5 / CSS3 / ES6+)                  │
│   • Dynamic Island (Компактная капсула и раскрытый виниловый плеер)   │
│   • 10-полосный эквалайзер Web Audio API & Canvas визуализатор        │
│   • Кэширование тегов и обложек в IndexedDB                            │
│   • Нечеткий поиск Fuse.js & парсер синхронизированных .LRC текстов    │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ REST API и аудио-стриминг (/api/stream)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Бэкенд сервис (Node.js + Express)                    │
│   • Сканирование файловой системы и отслеживание изменений            │
│   • Клиент Discord RPC (discord_presence.js)                           │
│   • Резолвер обложек высокого разрешения (Deezer, iTunes, Last.fm)     │
│   • Хранение конфигурации (music_folders.json, cover_cache.json)       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## <a id="installation-ru" name="installation-ru"></a>🚀 Быстрый старт и установка

### Вариант 1: Автономный переносимый EXE (Для пользователей)
Не требует установки Node.js, Python или дополнительных программ:
1. Скачайте **`MoonPlayer.exe`** из раздела [Releases](https://github.com/akvarium11/MoonPlayer/releases).
2. Запустите файл и сразу слушайте музыку!

---

### Вариант 2: Запуск из исходного кода (Для разработчиков)

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

#### Сборка автономного бинарника
```bash
# Сборка portable-версии для Windows (dist/MoonPlayer.exe)
npm run build

# Сборка установочного пакета Windows (NSIS Installer)
npm run build:installer
```

---

### Вариант 3: Сборка нативного C++ лаунчера (WebView2 / WebKitGTK)

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
