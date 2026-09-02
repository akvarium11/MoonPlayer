# 🧠 MoonPlayer — Память Проекта (Project Memory)

> **Документ памяти архитектуры, кодовой базы и контекста разработки проекта MoonPlayer.**  
> *Обновлено: Сентябрь 2026 г.*

---

## 📌 1. Обзор проекта (Overview)

**MoonPlayer** — это гибридный настольный аудио-плеер для локальной медиатеки с акцентом на современный UI/UX, высокую производительность и глубокую интеграцию с ОС и Discord.

- **Тип приложения**: Гибридное десктопное приложение (Native Shell + Node.js Backend Daemon + Web Client UI).
- **Платформы**: Windows 10/11 (MinGW / Edge WebView2) и Linux (GTK-3 / WebKit2GTK).
- **Лицензия**: GPL-3.0.
- **Порт по умолчанию**: `7644`.

---

## 🏗️ 2. Архитектура и стек технологий

```
┌──────────────────────────────────────────────────────────┐
│              MoonPlayer Native Launcher (C++)            │
│            (launcher.cpp + Webview2 / WebKitGTK)         │
│  - Управление жизненным циклом сервера Node.js (Daemon)  │
│  - Оконный менеджер, значок в панели задач, frameless UI │
└────────────────────────────┬─────────────────────────────┘
                             │ Встраивает WebView
                             ▼
┌──────────────────────────────────────────────────────────┐
│              Frontend UI (Vanilla HTML5 / CSS3 / JS)     │
│  - Floating Dynamic Island (компактный и раскрытый режим)│
│  - 10-полосный Web Audio ISO Equalizer                   │
│  - Smart Fuse.js Search (нечеткий поиск)                 │
│  - IndexedDB Metadata Cache                              │
│  - Visualizer Canvas & Canvas АЧХ эквалайзера            │
│  - Синхронизация текстов песен (.lrc)                    │
│  - Минималистичные бейджи форматов (FLAC [F] badge)      │
└────────────────────────────▲─────────────────────────────┘
                             │ HTTP REST API / Static / Stream
                             ▼
┌──────────────────────────────────────────────────────────┐
│              Backend Service (Node.js + Express)         │
│                        (server.js)                       │
│  - Сканирование директорий (scanDirectory)               │
│  - Потоковое воспроизведение аудио (/api/stream)         │
│  - Управление папками музыки (music_folders.json)        │
│  - Интеграция с Discord RPC (discord_presence.js)        │
│  - Автоматическое получение обложек альбомов             │
└──────────────────────────────────────────────────────────┘
```

### Стек:
- **Launcher**: C++17, Windows WebView2 SDK / Linux WebKit2GTK, Windows API (`ws2_32`, `ole32`, `dwmapi`).
- **Backend**: Node.js, Express (`^5.2.1`), `discord-rpc` (`^4.0.1`), File System API.
- **Frontend**: Чистый JavaScript (ES6+), CSS3 (CSS Variables, Flexbox, Keyframe Animations), HTML5 Audio & Web Audio API, FontAwesome 6, Google Fonts (`Unbounded`, `Outfit`), `jsmediatags`, `fuse.js`.

---

## 📁 3. Структура директорий и файлов

```
MoonPlayer/
├── assets/                    # Графика, логотипы, иконки (.png, .ico)
├── public/                    # Статические файлы клиентской части
│   ├── index.html             # Главная разметка плеера, модальные окна, Dynamic Island
│   ├── script.js              # Вся клиентская логика (аудио, эквалайзер, UI, IndexedDB)
│   └── style.css              # Стилизация интерфейса, анимации, адаптив, бейджи
├── webview2_sdk/              # Microsoft Edge WebView2 SDK (для Windows)
├── server.js                  # Express бэкенд, REST API и сканер файлов
├── discord_presence.js        # Модуль Discord Rich Presence & резолвер обложек
├── launcher.cpp               # C++ лаунчер-оболочка (запуск сервера и WebView)
├── resources.rc               # Ресурсы Windows (иконка приложения)
├── music_folders.json         # Сохраненные пути к папкам с музыкой на сервере
├── discord_config.json        # Конфигурация Discord RPC
├── cover_cache.json           # Кэш ссылок на найденные обложки треков
├── build_linux.sh             # Скрипт компиляции для Linux
├── package.json               # Зависимости и скрипты Node.js
├── README.md                  # Документация проекта (Eng / Rus)
└── PROJECT_MEMORY.md          # Данный файл памяти проекта
```

---

## 🔑 4. Ключевые компоненты и функционал

### 4.1. Поддержка аудиоформатов и FLAC-бейдж (`[F]`)
- **Поддерживаемые форматы**: `.mp3`, `.flac`, `.ogg`, `.wav`, `.m4a`, `.aac`, `.webm`, `.opus`.
- **FLAC-бейдж (`.flac-badge`)**:
  - Минималистичная векторная иконка в стиле Explicit (`E`), но с буквой **`F`**.
  - **Без фона** (`background: transparent;`): аккуратный прозрачный контур без закрашивания.
  - **Идеальное центрирование буквы "F"**: векторный контур SVG с математическим центрированием по осям X и Y ($7.0, 7.0$), не зависящий от шрифтов ОС, масштабирования или наведения курсора.
  - **Защита от наплыва на длинных треках**: строгие ограничения ширины (`flex: 0 1 auto`, `min-width: 0`, `max-width: 100%`, `overflow: hidden`, `padding-right` на панели острова 112px с запасом под кнопки Lock/Lyrics/Queue). Текст обрезается многоточием (`text-overflow: ellipsis`), бейдж всегда остается в границах блока и не налезает на смежные элементы интерфейса.
  - Размеры: базовый $14\times14$ px, `.flac-badge-mini` ($11\times11$ px для компактного острова) и `.flac-badge-queue` ($12\times12$ px для очереди).
  - Подсказка при наведении: `title="FLAC Lossless Audio"`.
  - Отображается:
    1. В строках треков альбомов, плейлистов и библиотеки (`appendMoreSongs`).
    2. В результатах поиска треков (`searchType === 'song'`).
    3. В очереди Dynamic Island (`updateIslandQueue`).
    4. В раскрытом плеере Dynamic Island (`#track-title`).
    5. В компактном плеере Dynamic Island (`#mini-track-title`).

### 4.2. Dynamic Island
- **Компактный режим**: Название трека, статусная анимация аудиоволн (mini-waveform), мини-обложка трека.
- **Раскрытый режим**:
  - Полноразмерная вращающаяся обложка винила с анимацией смены трека.
  - Управление воспроизведением (Shuffle, Prev, Play/Pause, Next, Loop One/All/Off).
  - Слайдер таймлайна с точной перемоткой и громкость с Mute.
  - Кнопки переключения секций: Lyrics (текст песни), Queue (очередь треков), Lock (закрепление открытого состояния).
  - Аудио-визуализатор на Canvas.

### 4.3. 10-полосный ISO-эквалайзер
- Частоты: `32Hz`, `64Hz`, `125Hz`, `250Hz`, `500Hz`, `1kHz`, `2kHz`, `4kHz`, `8kHz`, `16kHz`.
- Регулятор Preamp (Gain от -12dB до +12dB).
- Интерактивный холст графика АЧХ (интерполяция кривой сплайном в реальном времени).
- Встроенные пресеты (Rock, Pop, Bass Boost, Vocal, Jazz, EDM, Hip-Hop, Classical, Acoustic, Deep).
- Сохранение и удаление пользовательских пресетов в `localStorage`.

### 4.4. Discord Rich Presence
- Фоновый клиент RPC (`discord-rpc`).
- Default Client ID зафиксирован: `1543154845958275114` (опция ручного ввода Application ID скрыта/удалена из UI настроек).
- Передает в профиль: название трека, артиста, альбом, таймлайны воспроизведения (elapsed/remaining), статус паузы.
- Интеллектуальный поиск обложек через Deezer, iTunes Search API и Last.fm с локальным кэшированием в `cover_cache.json`.

### 4.5. Кэширование метаданных
- Быстрое сканирование больших библиотек благодаря IndexedDB (`moonplayer_metadata_db`).
- Парсинг тегов через `jsmediatags` пачками с ограничением конкурентности.
- Фоллбэк-парсинг из файловой структуры (`Artist - Title.ext` или `.../Artist/Album/Track.ext`).

---

## 🛠️ 5. Сборка и распространение

### 5.1. Автономный переносимый бинарник (Один `.exe` файл без зависимостей)
Для конечных пользователей собран полностью автономный исполняемый файл **`dist/MoonPlayer.exe`** (~96 MB):
- **Не требует установки Node.js, npm, Python или библиотек на компьютере пользователя**.
- Включает в себя всё: рантайм, Chromium окно, Express бэкенд, Discord RPC, шрифты и ассеты.
- Запускается в один клик на любой Windows 10/11:
```bash
npm run build        # Собирает автономный dist/MoonPlayer.exe (portable)
npm run build:installer # Собирает полноценный Windows инсталлятор (NSIS setup)
```

### 5.2. Запуск в режиме разработки:
```bash
npm start            # Запуск десктопного приложения в режиме разработки (Electron)
npm run server       # Запуск только фонового сервера Node.js (http://localhost:7644)
```

### 5.3. Классический C++ лаунчер (WebView2):
- **Windows (MinGW/GCC)**:
  ```cmd
  windres resources.rc -o resources.o
  g++ -std=c++17 launcher.cpp resources.o -o MoonPlayer.exe -Iwebview2_sdk/build/native/include -lws2_32 -lole32 -lversion -lshlwapi -luuid -luser32 -lgdi32 -ldwmapi -mwindows -municode
  del resources.o
  ```
- **Linux (GCC / GTK3)**:
  ```bash
  chmod +x build_linux.sh && ./build_linux.sh
  ```

---

## 💡 6. Соглашения и рекомендации для дальнейшей разработки

1. **Сохранение целостности CSS-переменных**: Цвета и акценты управляются через `:root` (`--accent`, `--card-bg`, `--hover-bg`, `--text-primary` и др.). При добавлении новых компонентов использовать существующие переменные.
2. **Безопасность строк**: Любой пользовательский ввод и названия треков должны экранироваться через `escapeHtml()` перед вставкой в `innerHTML`.
3. **Совместимость с IndexedDB**: При добавлении новых полей в объект трека всегда предусматривать обратную совместимость с записями в кэше (как это сделано с `isFlacTrack` через проверку расширений и путей).
4. **Синхронизация фонового демона**: Лаунчер C++ ожидает доступность порта `7644` при старте и корректно глушит дочерний процесс Node.js при закрытии окна.
