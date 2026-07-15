#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

echo "=== MoonPlayer Linux Build Script ==="
echo "Prerequisites:"
echo "  Ubuntu/Debian: sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev"
echo "  Fedora: sudo dnf install gcc-c++ gtk3-devel webkit2gtk3-devel"
echo "  Arch Linux: sudo pacman -S gcc gtk3 webkit2gtk"
echo ""

if ! pkg-config --exists gtk+-3.0 webkit2gtk-4.0; then
    echo "Warning: gtk+-3.0 or webkit2gtk-4.0 was not found by pkg-config."
    echo "Please install the development files for GTK3 and WebKit2GTK."
fi

echo "Compiling launcher.cpp..."
g++ -std=c++17 launcher.cpp -o MoonPlayer $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.0)

echo "Build successful! You can now run './MoonPlayer' to start the application."
