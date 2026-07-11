#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
// Link with ws2_32.lib for Windows
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <sys/types.h>
#include <limits.h>
#include <iostream>
#include <cstdlib>
#endif
#include <string>
#include <vector>

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
    return true;
}
#endif

#ifdef _WIN32
int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    const int PORT = 7644;
    
    // If server is already running, just open the browser and exit
    if (IsServerRunning(PORT)) {
        ShellExecuteW(NULL, L"open", L"http://localhost:7644", NULL, NULL, SW_SHOWNORMAL);
        return 0;
    }

    // 1. Get the path of the current executable
    wchar_t exePath[MAX_PATH];
    if (GetModuleFileNameW(NULL, exePath, MAX_PATH) == 0) {
        MessageBoxW(NULL, L"Failed to get executable directory path.", L"MoonPlayer Launcher Error", MB_OK | MB_ICONERROR);
        return 1;
    }

    // Extract directory from path
    std::wstring directory = exePath;
    size_t lastSlash = directory.find_last_of(L"\\/");
    if (lastSlash != std::wstring::npos) {
        directory = directory.substr(0, lastSlash);
    }

    // 2. Prepare command line buffer
    std::wstring cmd = L"node server.js";
    std::vector<wchar_t> cmdBuffer(cmd.begin(), cmd.end());
    cmdBuffer.push_back(L'\0'); // Null-terminate

    // 3. Start node server.js with CREATE_NO_WINDOW
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    
    BOOL success = CreateProcessW(
        NULL,
        cmdBuffer.data(),
        NULL,
        NULL,
        FALSE,
        CREATE_NO_WINDOW, // Hidden window process
        NULL,
        directory.c_str(), // Working directory of the exe
        &si,
        &pi
    );

    if (!success) {
        MessageBoxW(
            NULL, 
            L"Failed to launch Node.js server.\n\nPlease make sure Node.js is installed, added to your system PATH, and that server.js exists in the application directory.", 
            L"MoonPlayer Launcher Error", 
            MB_OK | MB_ICONERROR
        );
        return 1;
    }

    // Close process handles (let process run independently in background)
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    // 4. Wait briefly for the port to open, then launch browser
    for (int i = 0; i < 10; ++i) {
        Sleep(200);
        if (IsServerRunning(PORT)) {
            break;
        }
    }

    ShellExecuteW(NULL, L"open", L"http://localhost:7644", NULL, NULL, SW_SHOWNORMAL);
    return 0;
}
#else
int main(int argc, char* argv[]) {
    const int PORT = 7644;
    
    // If server is already running, just open the browser and exit
    if (IsServerRunning(PORT)) {
        system("xdg-open http://localhost:7644 &");
        return 0;
    }

    // Launch server in background
    std::string directory = GetExecutableDirectory();
    if (!LaunchServerLinux(directory)) {
        std::cerr << "Failed to launch server daemon." << std::endl;
        return 1;
    }

    // Wait briefly for port to open
    for (int i = 0; i < 10; ++i) {
        usleep(200000); // 200ms
        if (IsServerRunning(PORT)) {
            break;
        }
    }

    system("xdg-open http://localhost:7644 &");
    return 0;
}
#endif
