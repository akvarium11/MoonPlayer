#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
// Include MinGW support header for WebView2
#include "webview_mingw_support.h"
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <limits.h>
#include <iostream>
#include <cstdlib>
#endif

// Include webview wrapper (available for both Windows and Linux)
#include "webview.h"

#include <string>
#include <vector>

#ifdef _WIN32
// Global process handles for the Windows background Node.js server
HANDLE g_hServerProcess = NULL;
HANDLE g_hServerThread = NULL;
HANDLE g_hJob = NULL;
bool g_SpawnedServer = false;
#else
// Global process/pid for the Linux background Node.js server
pid_t g_ServerPid = -1;
bool g_SpawnedServer = false;
#endif

bool IsServerRunning(int port) {
#ifdef _WIN32
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return false;
    }
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        WSACleanup();
        return false;
    }
#else
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        return false;
    }
#endif

    sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    
#ifdef _WIN32
    if (inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr) != 1) {
        closesocket(sock);
        WSACleanup();
        return false;
    }
#else
    if (inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr) != 1) {
        close(sock);
        return false;
    }
#endif

    // Attempt to connect to local port
    bool running = (connect(sock, (sockaddr*)&addr, sizeof(addr)) == 0);

#ifdef _WIN32
    closesocket(sock);
    WSACleanup();
#else
    close(sock);
#endif
    return running;
}

#ifndef _WIN32
std::string GetExecutableDirectory() {
    char result[PATH_MAX];
    ssize_t count = readlink("/proc/self/exe", result, PATH_MAX);
    if (count == -1) {
        return "";
    }
    std::string path(result, count);
    size_t lastSlash = path.find_last_of('/');
    if (lastSlash != std::string::npos) {
        return path.substr(0, lastSlash);
    }
    return "";
}

bool LaunchServerLinux(const std::string& dir) {
    pid_t pid = fork();
    if (pid < 0) {
        return false;
    }
    if (pid == 0) {
        // Child process
        if (!dir.empty()) {
            if (chdir(dir.c_str()) != 0) {
                exit(1);
            }
        }
        
        // Redirect stdout/stderr/stdin to silence console
        freopen("/dev/null", "r", stdin);
        freopen("/dev/null", "w", stdout);
        freopen("/dev/null", "w", stderr);
        
        // Execute node server.js
        execlp("node", "node", "server.js", (char*)NULL);
        exit(1);
    }
    g_ServerPid = pid;
    g_SpawnedServer = true;
    return true;
}
#endif

#ifdef _WIN32
// Clean up spawned server process on Windows
void CleanupServer() {
    if (g_hJob != NULL) {
        CloseHandle(g_hJob);
        g_hJob = NULL;
    }
    if (g_SpawnedServer && g_hServerProcess != NULL) {
        // Soft terminate the process
        TerminateProcess(g_hServerProcess, 0);
        CloseHandle(g_hServerProcess);
        g_hServerProcess = NULL;
    }
    if (g_hServerThread != NULL) {
        CloseHandle(g_hServerThread);
        g_hServerThread = NULL;
    }
}
#else
// Clean up spawned server process on Linux
void CleanupServer() {
    if (g_SpawnedServer && g_ServerPid > 0) {
        kill(g_ServerPid, SIGTERM);
        int status;
        waitpid(g_ServerPid, &status, WNOHANG);
    }
}
#endif

#ifdef _WIN32
int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    const int PORT = 7644;
    const std::string SERVER_URL = "http://localhost:" + std::to_string(PORT);
    
    // Check if the server is already running
    if (!IsServerRunning(PORT)) {
        // 1. Get path of the current executable
        wchar_t exePath[MAX_PATH];
        if (GetModuleFileNameW(NULL, exePath, MAX_PATH) == 0) {
            MessageBoxW(NULL, L"Failed to determine executable directory.", L"MoonPlayer Launcher Error", MB_OK | MB_ICONERROR);
            return 1;
        }

        // Extract folder from path
        std::wstring directory = exePath;
        size_t lastSlash = directory.find_last_of(L"\\/");
        if (lastSlash != std::wstring::npos) {
            directory = directory.substr(0, lastSlash);
        }

        // 2. Start server.js in background with CREATE_NO_WINDOW
        std::wstring cmd = L"node server.js";
        std::vector<wchar_t> cmdBuffer(cmd.begin(), cmd.end());
        cmdBuffer.push_back(L'\0'); // Null-terminate

        STARTUPINFOW si = { sizeof(si) };
        PROCESS_INFORMATION pi;
        
        BOOL success = CreateProcessW(
            NULL,
            cmdBuffer.data(),
            NULL,
            NULL,
            FALSE,
            CREATE_NO_WINDOW, // Silent background process
            NULL,
            directory.c_str(), // Working directory
            &si,
            &pi
        );

        if (!success) {
            MessageBoxW(
                NULL, 
                L"Failed to launch Node.js backend.\n\nPlease verify that Node.js is installed, added to system PATH, and that server.js exists in the app folder.", 
                L"MoonPlayer Launcher Error", 
                MB_OK | MB_ICONERROR
            );
            return 1;
        }

        // Save process information so we can clean it up later
        g_hServerProcess = pi.hProcess;
        g_hServerThread = pi.hThread;
        g_SpawnedServer = true;

        // Associate with a Job Object to guarantee cleanup even if the parent crashes or is killed
        g_hJob = CreateJobObjectW(NULL, NULL);
        if (g_hJob != NULL) {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = { 0 };
            jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (SetInformationJobObject(g_hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli))) {
                AssignProcessToJobObject(g_hJob, pi.hProcess);
            }
        }

        // 3. Wait for the server port to open
        bool serverReady = false;
        for (int i = 0; i < 20; ++i) { // Wait up to 4 seconds (20 * 200ms)
            Sleep(200);
            if (IsServerRunning(PORT)) {
                serverReady = true;
                break;
            }
        }

        if (!serverReady) {
            CleanupServer();
            MessageBoxW(
                NULL,
                L"The background server did not respond in time.\n\nPlease try restarting the application.",
                L"MoonPlayer Startup Error",
                MB_OK | MB_ICONERROR
            );
            return 1;
        }
    }

    // 4. Create and run WebView2 application
    try {
        webview::webview w(false, nullptr);
        w.set_title("MoonPlayer");
        w.set_size(1200, 800, WEBVIEW_HINT_NONE);

        // Set custom window icon
        HWND hwnd = (HWND)w.window();
        if (hwnd != NULL) {
            HINSTANCE hInst = GetModuleHandleW(NULL);
            HICON hIconLarge = (HICON)LoadImageW(
                hInst,
                MAKEINTRESOURCEW(1),
                IMAGE_ICON,
                GetSystemMetrics(SM_CXICON),
                GetSystemMetrics(SM_CYICON),
                LR_DEFAULTCOLOR | LR_SHARED
            );
            HICON hIconSmall = (HICON)LoadImageW(
                hInst,
                MAKEINTRESOURCEW(1),
                IMAGE_ICON,
                GetSystemMetrics(SM_CXSMICON),
                GetSystemMetrics(SM_CYSMICON),
                LR_DEFAULTCOLOR | LR_SHARED
            );

            if (hIconLarge != NULL) {
                SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM)hIconLarge);
            }
            if (hIconSmall != NULL) {
                SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)hIconSmall);
            }
        }

        w.navigate(SERVER_URL);
        w.run();
    }
    catch (const std::exception& e) {
        std::string err = "Failed to initialize WebView2:\n";
        err += e.what();
        err += "\n\nPlease ensure you have Microsoft Edge WebView2 Runtime installed.";
        MessageBoxA(NULL, err.c_str(), "MoonPlayer Error", MB_OK | MB_ICONERROR);
    }
    catch (...) {
        MessageBoxW(NULL, L"An unexpected error occurred while initializing WebView2.", L"MoonPlayer Error", MB_OK | MB_ICONERROR);
    }

    // 5. Cleanup server process if we launched it
    CleanupServer();

    return 0;
}
#else
int main(int argc, char* argv[]) {
    const int PORT = 7644;
    const std::string SERVER_URL = "http://localhost:" + std::to_string(PORT);
    
    // Check if the server is already running
    if (!IsServerRunning(PORT)) {
        // Launch server in background
        std::string directory = GetExecutableDirectory();
        if (!LaunchServerLinux(directory)) {
            std::cerr << "Failed to launch server daemon." << std::endl;
            return 1;
        }

        // Wait briefly for port to open
        bool serverReady = false;
        for (int i = 0; i < 20; ++i) { // Wait up to 4 seconds (20 * 200ms)
            usleep(200000); // 200ms
            if (IsServerRunning(PORT)) {
                serverReady = true;
                break;
            }
        }

        if (!serverReady) {
            CleanupServer();
            std::cerr << "The background server did not respond in time." << std::endl;
            return 1;
        }
    }

    // Create and run WebView application on Linux
    try {
        webview::webview w(false, nullptr);
        w.set_title("MoonPlayer");
        w.set_size(1200, 800, WEBVIEW_HINT_NONE);
        w.navigate(SERVER_URL);
        w.run();
    }
    catch (const std::exception& e) {
        std::cerr << "Failed to initialize WebView: " << e.what() << std::endl;
        std::cerr << "Attempting fallback to system browser..." << std::endl;
        std::string cmd = "xdg-open " + SERVER_URL + " &";
        int ret = system(cmd.c_str());
        (void)ret;
    }
    catch (...) {
        std::cerr << "An unexpected error occurred while initializing WebView." << std::endl;
    }

    // Cleanup server process if we launched it
    CleanupServer();

    return 0;
}
#endif
