# ✨ MoonPlayer

# [🇺🇸 Eng](https://github.com/akvarium11/MoonPlayer#header) | [🇷🇺 Rus](https://github.com/akvarium11/MoonPlayer#header-rus)

## <a id="header"></a>📖 Table of Contents
- [About the Project](#-about-the-project)
- [Features](#%EF%B8%8Ffeatures)
- [Compilation](#%EF%B8%8Fcompilation)
- [How to use](#-how-to-use)
- [License](#-license)

---

## 📌 About the Project

*MoonPlayer* is a lightweight, high-performance desktop music player designed for listening to local audio files. It combines a native C++ launcher wrapper (`launcher.cpp` powered by Webview) and a feature-rich, high-performance Node.js backend (`server.js`) with an interactive web UI. It is built to look stunning while running efficiently on both Windows and Linux.

> [!IMPORTANT]  
> Make sure to install [Node.js](https://nodejs.org/) on your computer, as it is required to run the player backend.

---

## ⌨️Features 

- [x] **Desktop WebView Shell** - Native window container wrapping the application using Edge WebView2 (Windows) and WebKit2GTK (Linux).
- [x] **Floating Dynamic Island** - Interactive, responsive island with smooth animations, compact/expanded states, and audio waveforms.
- [x] **Accent Customization** - Dynamic theme accents including white, pink, blue, neon green, orange, purple, and a custom color picker.
- [x] **Smart Search** - Typo-tolerant, fuzzy search for songs, albums, and artists powered by Fuse.js.
- [x] **Sleep Timer** - Built-in shutdown countdown (15, 30, 45, 60 minutes) to pause playback automatically.
- [x] **Visualizer** - Interactive audio frequency visualizer rendered in real-time.
- [x] **Background Customization** - Upload custom images and tweak blur/opacity directly from the settings.
- [x] **Automatic Server Daemon** - The C++ wrapper automatically boots and halts the Node.js server daemon to clean up resources upon exit.
- [x] **3D Card & Cursor Glow** - Eye-candy animations, tilt effects, and snow particles for premium aesthetics.
- [x] **Lyrics Sync** - Real-time synchronization and display of `.lrc` lyrics file formats inside the expanded Dynamic Island.


---

## 🛠️Compilation

### 🪟 Windows (MinGW/GCC)
To compile the Windows version, you will need MinGW (with `g++` and `windres` toolchains):

1. Compile the icon and resource file:
   ```cmd
   windres resources.rc -o resources.o
   ```
2. Compile the launcher executable:
   ```cmd
   g++ -std=c++17 launcher.cpp resources.o -o MoonPlayer.exe -Iwebview2_sdk/build/native/include -lws2_32 -lole32 -lversion -lshlwapi -luuid -luser32 -lgdi32 -ldwmapi -mwindows -municode
   ```
3. Remove the temporary object file:
   ```cmd
   del resources.o
   ```

### 🐧 Linux (GTK3 / WebKit2GTK)
Ensure you have the required development headers installed on your distribution:

- **Ubuntu/Debian**:
  ```bash
  sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev
  ```
- **Fedora**:
  ```bash
  sudo dnf install gcc-c++ gtk3-devel webkit2gtk3-devel
  ```
- **Arch Linux**:
  ```bash
  sudo pacman -S gcc gtk3 webkit2gtk
  ```

Compile using the build script or manually:
- **Using build script**:
  ```bash
  chmod +x build_linux.sh
  ./build_linux.sh
  ```
- **Manually**:
  ```bash
  g++ -std=c++17 launcher.cpp -o MoonPlayer $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.0)
  ```

---

## ▶️How to Use

1. Place your music folders in any location on your PC.
2. Launch `MoonPlayer` (or `MoonPlayer.exe` on Windows).
3. Open **SETTINGS** (gear icon) in the top-right corner.
4. Input the absolute path of your music directory in **Server Music Folders** and click **ADD**.
5. Click **Close** and enjoy your custom library!

---

## 📄 License

This project is licensed under the ISC License.

---
---

# <a id="header-rus"></a>✨ MoonPlayer (Русский)

## 📖 Оглавление
- [О проекте](#-о-проекте)
- [Возможности](#-возможности)
- [Компиляция](#-компиляция)
- [Как использовать](#-как-использовать)
- [Лицензия](#-лицензия)

---

## 📌 О проекте

*MoonPlayer* — это легкий и производительный локальный музыкальный плеер для прослушивания аудиофайлов с вашего компьютера. Он совмещает нативный C++ лаунчер-клиент (`launcher.cpp` на базе Webview) и функциональный Node.js сервер (`server.js`) со стильным и современным веб-интерфейсом.

> [!IMPORTANT]  
> Для работы плеера на компьютере должен быть установлен [Node.js](https://nodejs.org/).

---

## ⌨️Возможности 

- [x] **Нативный WebView-контейнер** - Оболочка на C++ с использованием Edge WebView2 (Windows) и WebKit2GTK (Linux).
- [x] **Интерактивный Dynamic Island** - Всплывающий остров с красивыми анимациями, компактным/расширенным состоянием и звуковыми волнами.
- [x] **Кастомизация цветов** - Выбор цветовых акцентов (розовый, голубой, зеленый, оранжевый, фиолетовый) и палитра для своего цвета.
- [x] **Умный поиск** - Отказоустойчивый нечеткий поиск треков, альбомов и артистов на базе Fuse.js.
- [x] **Таймер сна** - Встроенный таймер выключения (15, 30, 45, 60 минут) для автопаузы.
- [x] **Аудио-визуализатор** - Частотный визуализатор, рисующийся на холсте в реальном времени.
- [x] **Настройка фона** - Загрузка своего фонового изображения, настройка прозрачности и размытия (blur) прямо из настроек.
- [x] **Автоматическое управление сервером** - C++ лаунчер сам запускает Node.js в фоне и автоматически закрывает его при выходе.
- [x] **3D-наклон и свечение** - Эффекты наклона карточек, свечение за курсором и падающие снежинки для премиального визуала.
- [x] **Синхронизация текста песен** - Отображение синхронизированного текста из файлов `.lrc` прямо внутри Dynamic Island.


---

## 🛠️Компиляция

### 🪟 Windows (MinGW/GCC)
Для сборки Windows-версии вам понадобится компилятор MinGW (с установленными `g++` и `windres`):

1. Компиляция иконки и ресурсов:
   ```cmd
   windres resources.rc -o resources.o
   ```
2. Сборка исполняемого файла:
   ```cmd
   g++ -std=c++17 launcher.cpp resources.o -o MoonPlayer.exe -Iwebview2_sdk/build/native/include -lws2_32 -lole32 -lversion -lshlwapi -luuid -luser32 -lgdi32 -ldwmapi -mwindows -municode
   ```
3. Удаление временного файла ресурсов:
   ```cmd
   del resources.o
   ```

### 🐧 Linux (GTK3 / WebKit2GTK)
Установите необходимые пакеты разработчика для вашего дистрибутива:

- **Ubuntu/Debian**:
  ```bash
  sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev
  ```
- **Fedora**:
  ```bash
  sudo dnf install gcc-c++ gtk3-devel webkit2gtk3-devel
  ```
- **Arch Linux**:
  ```bash
  sudo pacman -S gcc gtk3 webkit2gtk
  ```

Скомпилируйте проект с помощью скрипта или вручную:
- **Через скрипт сборки**:
  ```bash
  chmod +x build_linux.sh
  ./build_linux.sh
  ```
- **Вручную**:
  ```bash
  g++ -std=c++17 launcher.cpp -o MoonPlayer $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.0)
  ```

---

## ▶️Как использовать

1. Поместите папки с музыкой в любое место на ПК.
2. Запустите `MoonPlayer` (или `MoonPlayer.exe` в Windows).
3. Нажмите на иконку шестеренки (**SETTINGS**) в правом верхнем углу.
4. Введите абсолютный путь к папке с музыкой в поле **Server Music Folders** и нажмите **ADD**.
5. Закройте настройки и наслаждайтесь прослушиванием!

---

## 📄 Лицензия

Этот проект распространяется под лицензией ISC.
