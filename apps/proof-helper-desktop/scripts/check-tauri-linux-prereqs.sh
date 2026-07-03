#!/usr/bin/env bash
set -u

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ok: non-Linux host; Tauri WebKitGTK prerequisites do not apply"
  exit 0
fi

failed=0
missing_packages=()

add_missing_package() {
  local package="$1"
  local existing
  for existing in "${missing_packages[@]:-}"; do
    if [[ "$existing" == "$package" ]]; then
      return
    fi
  done
  missing_packages+=("$package")
}

mark_missing() {
  local package="$1"
  local label="$2"
  echo "missing: ${label} (${package})"
  add_missing_package "$package"
  failed=1
}

check_command() {
  local command_name="$1"
  local package="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    echo "ok: ${command_name}"
  else
    mark_missing "$package" "$command_name"
  fi
}

check_pkg_config() {
  local query="$1"
  local module_name="$2"
  local package="$3"
  if pkg-config --exists "$query"; then
    local version
    version="$(pkg-config --modversion "$module_name" 2>/dev/null || true)"
    if [[ -n "$version" ]]; then
      echo "ok: ${module_name} ${version}"
    else
      echo "ok: ${module_name}"
    fi
  else
    mark_missing "$package" "${module_name}.pc"
  fi
}

check_path() {
  local path="$1"
  local package="$2"
  local label="$3"
  if [[ -e "$path" ]]; then
    echo "ok: ${path}"
  else
    mark_missing "$package" "$label"
  fi
}

check_command "pkg-config" "pkg-config"
check_command "cc" "build-essential"
check_command "curl" "curl"
check_command "wget" "wget"
check_command "file" "file"

if command -v pkg-config >/dev/null 2>&1; then
  check_pkg_config "openssl" "openssl" "libssl-dev"
  check_pkg_config "dbus-1" "dbus-1" "libdbus-1-dev"
  check_pkg_config "glib-2.0 >= 2.70" "glib-2.0" "libglib2.0-dev"
  check_pkg_config "gio-2.0" "gio-2.0" "libglib2.0-dev"
  check_pkg_config "gobject-2.0" "gobject-2.0" "libglib2.0-dev"
  check_pkg_config "gtk+-3.0" "gtk+-3.0" "libgtk-3-dev"
  check_pkg_config "libsoup-3.0" "libsoup-3.0" "libsoup-3.0-dev"
  check_pkg_config "javascriptcoregtk-4.1" "javascriptcoregtk-4.1" "libjavascriptcoregtk-4.1-dev"
  check_pkg_config "webkit2gtk-4.1" "webkit2gtk-4.1" "libwebkit2gtk-4.1-dev"
  check_pkg_config "ayatana-appindicator3-0.1" "ayatana-appindicator3-0.1" "libayatana-appindicator3-dev"
  check_pkg_config "librsvg-2.0" "librsvg-2.0" "librsvg2-dev"
fi

check_path "/usr/include/xdo.h" "libxdo-dev" "xdo.h"

if (( failed != 0 )); then
  echo
  echo "Install the missing Linux Tauri prerequisites on Ubuntu/Debian with:"
  echo "  sudo apt-get update"
  printf "  sudo apt-get install -y"
  for package in "${missing_packages[@]}"; do
    printf " %s" "$package"
  done
  echo
  echo
  echo "Full recommended set for this app:"
  echo "  sudo apt-get install -y build-essential curl wget file pkg-config libssl-dev libdbus-1-dev libglib2.0-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev"
  exit 1
fi

echo "ok: Linux Tauri prerequisites are present"
