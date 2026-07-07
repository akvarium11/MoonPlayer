#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <string>
#include <vector>

// Link with ws2_32.lib
#pragma comment(lib, "ws2_32.lib")

bool IsServerRunning(int port) {
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return false;
    }

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        WSACleanup();
        return false;
    }

    sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    
    // Resolve loopback
    if (inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr) != 1) {
        closesocket(sock);
        WSACleanup();
        return false;
    }

    // Attempt to connect to local port
    bool running = (connect(sock, (sockaddr*)&addr, sizeof(addr)) == 0);

    closesocket(sock);
    WSACleanup();
    return running;
}

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
    // We poll the port for up to 2 seconds (10 attempts, 200ms apart)
    for (int i = 0; i < 10; ++i) {
        Sleep(200);
        if (IsServerRunning(PORT)) {
            break;
        }
    }

    ShellExecuteW(NULL, L"open", L"http://localhost:7644", NULL, NULL, SW_SHOWNORMAL);
    return 0;
}
