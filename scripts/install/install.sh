#!/bin/sh
# DH Studio installer for macOS and Linux:
#   curl -fsSL https://github.com/OnlyDev-India/data-hive-studio/releases/latest/download/install.sh | sh
# Options: DH_NO_LAUNCH=1, DH_FORMAT=deb|rpm|appimage (Linux)

# Everything runs inside main, so a download cut off halfway runs nothing.
main() {
  set -eu

  VERSION="__DH_VERSION__"
  REPO="__DH_REPO__"
  RELEASES="https://github.com/$REPO/releases"
  BUNDLE_ID="com.dh-studio.dev"
  MAC_APP="/Applications/DH Studio.app"
  APPIMAGE_PATH="$HOME/.local/bin/dh-studio.AppImage"
  DESKTOP_FILE="$HOME/.local/share/applications/dh-studio.desktop"
  ICON_PATH="$HOME/.local/share/icons/dh-studio.png"

  say() { printf '%s\n' "$*"; }
  die() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
  }
  has() { command -v "$1" >/dev/null 2>&1; }

  case "$VERSION$REPO" in
    *__DH_*) die "This is a template. Run it from a release URL." ;;
  esac

  fetch() {
    if has curl; then
      curl -fsSL --proto '=https' -o "$2" "$1" || die "Download failed: $1"
    elif has wget; then
      wget -q -O "$2" "$1" || die "Download failed: $1"
    else
      die "Needs curl or wget to download DH Studio."
    fi
  }

  sha256_of() {
    if has shasum; then
      shasum -a 256 "$1" | awk '{print $1}'
    else
      sha256sum "$1" | awk '{print $1}'
    fi
  }

  # Prints the SHA256SUMS.txt line whose file name ends with $1; stops unless exactly one does.
  sums_line() {
    matches=$(awk -v s="$1" 'length($2) >= length(s) && substr($2, length($2) - length(s) + 1) == s' "$TMP/SHA256SUMS.txt")
    count=$(printf '%s' "$matches" | grep -c . || true)
    [ "$count" -eq 1 ] || die "Expected one file ending in $1 in SHA256SUMS.txt, found $count."
    printf '%s\n' "$matches"
  }

  # OS and CPU
  OS=$(uname -s)
  case "$OS" in
    Darwin)
      if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
        SUFFIX="_aarch64.app.tar.gz"
      else
        SUFFIX="_x64.app.tar.gz"
      fi
      ;;
    Linux)
      case "$(uname -m)" in
        x86_64 | amd64) ;;
        *) die "DH Studio has no Linux build for $(uname -m) yet. See $RELEASES" ;;
      esac
      ;;
    *)
      die "This installer is for macOS and Linux. On Windows, run this in PowerShell: irm $RELEASES/latest/download/install.ps1 | iex"
      ;;
  esac

  SUDO=""
  NO_FUSE=0
  if [ "$OS" = "Linux" ] && [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
  fi

  # Linux format
  if [ "$OS" = "Linux" ]; then
    FORMAT="${DH_FORMAT:-}"
    PM=""
    for candidate in apt-get dnf yum zypper; do
      if has "$candidate"; then
        PM="$candidate"
        break
      fi
    done

    if [ -n "$FORMAT" ]; then
      case "$FORMAT" in
        deb) [ "$PM" = "apt-get" ] || die "DH_FORMAT=deb needs apt-get, which isn't installed." ;;
        rpm) case "$PM" in dnf | yum | zypper) ;; *) die "DH_FORMAT=rpm needs dnf, yum or zypper, which isn't installed." ;; esac ;;
        appimage) ;;
        *) die "DH_FORMAT must be deb, rpm or appimage, not '$FORMAT'." ;;
      esac
      if [ "$FORMAT" != "appimage" ] && [ -n "$SUDO" ] && ! has sudo; then
        die "Installing the $FORMAT needs sudo, which isn't installed. Run as root, or use DH_FORMAT=appimage."
      fi
    else
      case "$PM" in
        apt-get) FORMAT="deb" ;;
        dnf | yum | zypper) FORMAT="rpm" ;;
        *) FORMAT="appimage" ;;
      esac
      if [ "$FORMAT" != "appimage" ] && [ -n "$SUDO" ] && ! has sudo; then
        say "sudo isn't installed, so installing the AppImage for your user instead of the $FORMAT."
        FORMAT="appimage"
      fi
    fi

    case "$FORMAT" in
      deb) SUFFIX="_amd64.deb" ;;
      rpm) SUFFIX=".x86_64.rpm" ;;
      appimage) SUFFIX="_amd64.AppImage" ;;
    esac
  fi

  # Temp folder
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/dh-studio.XXXXXX")
  trap 'rm -rf "$TMP"' EXIT
  trap 'exit 130' INT TERM
  chmod 755 "$TMP"

  # Download and verify
  say "Downloading DH Studio $VERSION..."
  BASE="$RELEASES/download/v$VERSION"
  fetch "$BASE/SHA256SUMS.txt" "$TMP/SHA256SUMS.txt"
  LINE=$(sums_line "$SUFFIX")
  EXPECTED=$(printf '%s' "$LINE" | awk '{print $1}')
  FILE=$(printf '%s' "$LINE" | awk '{print $2}')
  fetch "$BASE/$FILE" "$TMP/$FILE"
  ACTUAL=$(sha256_of "$TMP/$FILE")
  [ "$ACTUAL" = "$EXPECTED" ] || die "Checksum mismatch for $FILE. Nothing was installed."
  chmod 644 "$TMP/$FILE"

  # Quit a running app
  if [ "$OS" = "Darwin" ]; then
    is_running() { [ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" = "true" ]; }
    ask_quit() { osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true; }
  else
    is_running() { has pgrep && pgrep -x dh-studio >/dev/null 2>&1; }
    ask_quit() { pkill -TERM -x dh-studio 2>/dev/null || true; }
  fi

  if is_running; then
    say "Quitting DH Studio so it can be replaced..."
    ask_quit
    waited=0
    while is_running; do
      if [ "$waited" -ge 20 ]; then
        die "DH Studio is still open. Quit it and run the command again."
      fi
      sleep 1
      waited=$((waited + 1))
    done
  fi

  # Install
  if [ "$OS" = "Darwin" ]; then
    mkdir "$TMP/x"
    tar -xzf "$TMP/$FILE" -C "$TMP/x"
    [ -d "$TMP/x/DH Studio.app" ] || die "$FILE doesn't contain DH Studio.app."

    if [ ! -w /Applications ]; then
      SUDO="sudo"
      say "Installing to /Applications needs your password."
    fi
    NEW="/Applications/.DH Studio.app.new"
    $SUDO rm -rf "$NEW"
    $SUDO ditto "$TMP/x/DH Studio.app" "$NEW" || die "Couldn't copy DH Studio into /Applications."
    $SUDO rm -rf "$MAC_APP"
    $SUDO mv "$NEW" "$MAC_APP"
    $SUDO xattr -dr com.apple.quarantine "$MAC_APP" 2>/dev/null || true
    INSTALLED="$MAC_APP"
  else
    case "$FORMAT" in
      deb)
        $SUDO apt-get install -y --allow-downgrades "$TMP/$FILE" || die "apt-get couldn't install $FILE."
        INSTALLED="/usr/bin/dh-studio"
        ;;
      rpm)
        if [ "$PM" = "zypper" ]; then
          $SUDO zypper --non-interactive install --allow-unsigned-rpm --oldpackage "$TMP/$FILE" ||
            die "zypper couldn't install $FILE."
        else
          # install refuses an older version than the one installed, so fall back to downgrade.
          NAME=$(rpm -qp --qf '%{NAME}' "$TMP/$FILE" 2>/dev/null)
          WANT=$(rpm -qp --qf '%{VERSION}-%{RELEASE}' "$TMP/$FILE" 2>/dev/null)
          $SUDO "$PM" install -y "$TMP/$FILE" || true
          if [ "$(rpm -q --qf '%{VERSION}-%{RELEASE}' "$NAME" 2>/dev/null)" != "$WANT" ]; then
            $SUDO "$PM" downgrade -y "$TMP/$FILE" || die "$PM couldn't install $FILE."
          fi
        fi
        INSTALLED="/usr/bin/dh-studio"
        ;;
      appimage)
        mkdir -p "$(dirname "$APPIMAGE_PATH")" "$(dirname "$DESKTOP_FILE")"
        cp "$TMP/$FILE" "$APPIMAGE_PATH.new"
        chmod 755 "$APPIMAGE_PATH.new"
        mv "$APPIMAGE_PATH.new" "$APPIMAGE_PATH"

        ICON_LINE=""
        if (cd "$TMP" && "$APPIMAGE_PATH" --appimage-extract 'usr/share/icons/hicolor/*/apps/*.png' >/dev/null 2>&1); then
          icon=$(find "$TMP/squashfs-root" -type f -name '*.png' -path '*128x128*' 2>/dev/null | head -n 1)
          [ -n "$icon" ] || icon=$(find "$TMP/squashfs-root" -type f -name '*.png' 2>/dev/null | head -n 1)
          if [ -n "$icon" ]; then
            mkdir -p "$(dirname "$ICON_PATH")"
            cp "$icon" "$ICON_PATH" && ICON_LINE="Icon=$ICON_PATH"
          fi
        fi

        {
          echo "[Desktop Entry]"
          echo "Type=Application"
          echo "Name=DH Studio"
          echo "Comment=Desktop client for SQLite, PostgreSQL and MongoDB"
          echo "Exec=\"$APPIMAGE_PATH\" %F"
          [ -z "$ICON_LINE" ] || echo "$ICON_LINE"
          echo "Terminal=false"
          echo "Categories=Development;Database;"
        } >"$DESKTOP_FILE"
        has update-desktop-database && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
        INSTALLED="$APPIMAGE_PATH"

        LDCONFIG=$(command -v ldconfig || echo /sbin/ldconfig)
        if [ -x "$LDCONFIG" ] && ! "$LDCONFIG" -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
          case "$PM" in
            apt-get) fuse_cmd="sudo apt install libfuse2" ;;
            dnf | yum) fuse_cmd="sudo $PM install fuse-libs" ;;
            zypper) fuse_cmd="sudo zypper install libfuse2" ;;
            *) if has pacman; then fuse_cmd="sudo pacman -S fuse2"; else fuse_cmd="your package manager's libfuse2 package"; fi ;;
          esac
          say "The AppImage needs libfuse2 to run, which isn't installed. Add it with: $fuse_cmd"
          say "Then open DH Studio from your app menu."
          NO_FUSE=1
        fi
        ;;
    esac
  fi

  say "DH Studio $VERSION is installed at $INSTALLED"

  # Launch
  if [ "${DH_NO_LAUNCH:-}" = "1" ]; then
    return 0
  fi

  if [ "$OS" = "Darwin" ]; then
    open "$MAC_APP"
    return 0
  fi

  if [ "$NO_FUSE" = "1" ]; then
    return 0
  fi

  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    say "No desktop session found, so not opening DH Studio."
    return 0
  fi

  nohup "$INSTALLED" >/dev/null 2>&1 &
}

main "$@"
