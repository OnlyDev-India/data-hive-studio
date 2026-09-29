#!/bin/sh
# DH Studio installer for macOS and Linux:
#   curl -fsSL https://github.com/OnlyDev-India/data-hive-studio/releases/latest/download/install.sh | sh
# Options: DH_NO_LAUNCH=1, DH_VERBOSE=1, DH_FORMAT=deb|rpm|appimage (Linux)

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

  START=$(date +%s)
  TMP=""
  LOG=""
  BG_PID=""
  STEP=""
  STEP_T0=0
  LAST_OUT=0
  LINE_OPEN=0
  BAR_OPEN=0
  CURSOR_HIDDEN=0

  # Output mode: fancy (UTF-8 terminal), ascii (other terminal) or plain (pipe, log, TERM=dumb).
  MODE=plain
  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
      *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) MODE=fancy ;;
      *) MODE=ascii ;;
    esac
  fi
  if [ "$MODE" = fancy ]; then
    OK_MARK="✓"
    FAIL_MARK="✗"
  else
    OK_MARK="ok"
    FAIL_MARK="x"
  fi
  C_BLUE="" C_GREEN="" C_RED="" C_DIM="" C_BOLD="" C_OFF=""
  if [ "$MODE" != plain ] && [ -z "${NO_COLOR:-}" ]; then
    C_BLUE=$(printf '\033[1;34m')
    C_GREEN=$(printf '\033[32m')
    C_RED=$(printf '\033[31m')
    C_DIM=$(printf '\033[2m')
    C_BOLD=$(printf '\033[1m')
    C_OFF=$(printf '\033[0m')
  fi
  COLS=80
  if [ "$MODE" != plain ]; then
    # tput reads the size from stderr when stdout is this command substitution.
    cols=$( (tput cols 2>/dev/tty) 2>/dev/null || true)
    case "$cols" in '' | *[!0-9]*) cols=${COLUMNS:-} ;; esac
    case "$cols" in '' | *[!0-9]*) ;; *) COLS=$cols ;; esac
  fi
  if sleep 0.1 2>/dev/null; then TICK=0.1; else TICK=1; fi

  has() { command -v "$1" >/dev/null 2>&1; }

  # Sets T to a duration: <1s, 42s, 1m 05s.
  fmt_time() {
    if [ "$1" -lt 1 ]; then
      T="<1s"
    elif [ "$1" -lt 60 ]; then
      T="${1}s"
    else
      T=$(printf '%dm %02ds' $(($1 / 60)) $(($1 % 60)))
    fi
  }

  # Sets MB to a byte count in MB with one decimal.
  fmt_mb() {
    _t=$((($1 * 10 + 524288) / 1048576))
    MB="$((_t / 10)).$((_t % 10))"
  }

  hide_cursor() {
    printf '\033[?25l'
    CURSOR_HIDDEN=1
  }
  show_cursor() {
    [ "$CURSOR_HIDDEN" = 0 ] || printf '\033[?25h'
    CURSOR_HIDDEN=0
  }

  # Redraws the open step line with a tail (spinner or meter) of the given width, cut to fit.
  draw() {
    _room=$((COLS - 6 - $2))
    _label=$STEP
    if [ "${#_label}" -gt "$_room" ]; then
      if [ "$_room" -gt 3 ]; then
        _label="$(printf '%s' "$STEP" | cut -c "1-$((_room - 3))")..."
      else
        _label=""
      fi
    fi
    printf '\r%s==>%s %s%s%s %s\033[K' "$C_BLUE" "$C_OFF" "$C_BOLD" "$_label" "$C_OFF" "$1"
  }

  # Ends an open step line so the next output starts on its own line.
  end_line() {
    if [ "$LINE_OPEN" = 1 ]; then
      printf '\n'
      LINE_OPEN=0
      BAR_OPEN=0
      show_cursor
    fi
  }

  # Clears the download bar line under the step and moves back up to the step line.
  close_bar() {
    if [ "$BAR_OPEN" = 1 ]; then
      printf '\r\033[K\033[1A'
      BAR_OPEN=0
    fi
  }

  BAR_EQ="========================================"
  BAR_SP="                                        "
  # Sets BAR to a bar $2 wide (at most 40) for percent $1, like [=====>     ].
  bar() {
    _fill=$(($1 * $2 / 100))
    if [ "$_fill" -ge "$2" ]; then
      BAR="[$(printf "%.${2}s" "$BAR_EQ")]"
    else
      BAR="[$(printf "%.${_fill}s" "$BAR_EQ")>$(printf "%.$(($2 - _fill - 1))s" "$BAR_SP")]"
    fi
  }

  step_start() {
    STEP=$1
    STEP_T0=$(date +%s)
    LAST_OUT=$STEP_T0
    if [ "$MODE" = plain ]; then
      printf '==> %s\n' "$1"
    else
      hide_cursor
      LINE_OPEN=1
      draw "" 0
    fi
  }

  step_done() {
    fmt_time $(($(date +%s) - STEP_T0))
    if [ "$MODE" = plain ]; then
      printf 'ok %s (%s)\n' "$1" "$T"
    else
      close_bar
      printf '\r\033[K%s%s%s %s %s(%s)%s\n' "$C_GREEN" "$OK_MARK" "$C_OFF" "$1" "$C_DIM" "$T" "$C_OFF"
      show_cursor
    fi
    STEP=""
    LINE_OPEN=0
  }

  # $1 overrides the time, for example "cancelled".
  step_fail() {
    fmt_time $(($(date +%s) - STEP_T0))
    if [ "$MODE" = plain ]; then
      printf 'x %s (%s)\n' "$STEP" "${1:-$T}"
    else
      close_bar
      printf '\r\033[K%s%s%s %s %s(%s)%s\n' "$C_RED" "$FAIL_MARK" "$C_OFF" "$STEP" "$C_DIM" "${1:-$T}" "$C_OFF"
      show_cursor
    fi
    STEP=""
    LINE_OPEN=0
  }

  note() { printf '  Note: %s\n' "$*"; }

  # Prints the error, then any further arguments as lines of their own.
  die() {
    [ -z "$STEP" ] || step_fail
    printf 'Error: %s\n' "$1" >&2
    shift
    for line in "$@"; do printf '%s\n' "$line" >&2; done
    exit 1
  }

  # Like die, plus the tail of the captured tool output and a kept copy of the log.
  die_log() {
    [ -z "$STEP" ] || step_fail
    printf 'Error: %s\n' "$1" >&2
    if [ -n "$LOG" ] && [ -s "$LOG" ]; then
      tail -n 20 "$LOG" | tr -d '\r' | sed 's/^/    /' >&2
      kept="${TMPDIR:-/tmp}/dh-studio-install-$$.log"
      if cp "$LOG" "$kept" 2>/dev/null; then printf 'Full log: %s\n' "$kept" >&2; fi
    fi
    exit 1
  }

  kill_bg() {
    [ -n "$BG_PID" ] || return 0
    if has pkill; then pkill -TERM -P "$BG_PID" 2>/dev/null || true; fi
    kill -TERM "$BG_PID" 2>/dev/null || true
    BG_PID=""
  }

  on_exit() {
    show_cursor
    [ -z "$TMP" ] || rm -rf "$TMP"
  }

  on_cancel() {
    kill_bg
    [ -z "$STEP" ] || step_fail cancelled
    exit 130
  }

  trap on_exit EXIT
  trap on_cancel INT TERM

  # Plain mode: prints "still working" when nothing has printed for 15 seconds.
  heartbeat() {
    _now=$(date +%s)
    if [ $((_now - LAST_OUT)) -ge 15 ]; then
      fmt_time $((_now - STEP_T0))
      printf '    still working (%s)\n' "$T"
      LAST_OUT=$_now
    fi
  }

  spin() {
    if [ "$MODE" = plain ]; then
      heartbeat
      return 0
    fi
    if [ "$MODE" = fancy ]; then
      case $(($1 % 10)) in
        0) _f='⠋' ;; 1) _f='⠙' ;; 2) _f='⠹' ;; 3) _f='⠸' ;; 4) _f='⠼' ;;
        5) _f='⠴' ;; 6) _f='⠦' ;; 7) _f='⠧' ;; 8) _f='⠇' ;; *) _f='⠏' ;;
      esac
    else
      case $(($1 % 4)) in
        0) _f='|' ;; 1) _f='/' ;; 2) _f='-' ;; *) _f='\' ;;
      esac
    fi
    draw "$_f" 1
  }

  # Download meter: a bar line under the step on a terminal, a bar per 25% in plain mode,
  # and a growing MB count when the size is unknown.
  meter() {
    _got=0
    [ ! -f "$DL_DEST" ] || _got=$(wc -c <"$DL_DEST")
    _got=$((_got + 0))
    fmt_mb "$_got"
    if [ "$DL_TOTAL" -gt 0 ]; then
      _pct=$((_got * 100 / DL_TOTAL))
      [ "$_pct" -le 100 ] || _pct=100
      if [ "$MODE" = plain ]; then
        while [ "$DL_MARK" -le 100 ] && [ "$_pct" -ge "$DL_MARK" ]; do
          bar "$DL_MARK" 30
          printf '    %s %3d%%\n' "$BAR" "$DL_MARK"
          DL_MARK=$((DL_MARK + 25))
          LAST_OUT=$(date +%s)
        done
        heartbeat
      else
        _text=$(printf '%3d%%  %s / %s MB' "$_pct" "$MB" "$DL_TOTAL_MB")
        if [ "$BAR_OPEN" = 0 ]; then
          printf '\n'
          BAR_OPEN=1
        fi
        _w=$((COLS - 9 - ${#_text}))
        [ "$_w" -le 40 ] || _w=40
        if [ "$_w" -ge 10 ]; then
          bar "$_pct" "$_w"
          printf '\r    %s  %s\033[K' "$BAR" "$_text"
        else
          printf '\r    %s\033[K' "$_text"
        fi
      fi
    elif [ "$MODE" = plain ]; then
      _now=$(date +%s)
      if [ $((_now - LAST_OUT)) -ge 15 ]; then
        printf '    %s MB\n' "$MB"
        LAST_OUT=$_now
      fi
    else
      _text="$MB MB"
      draw "$_text" "${#_text}"
    fi
  }

  # Waits for BG_PID, calling the drawer ($1) every tick. Returns the background exit code.
  wait_bg() {
    _n=0
    while kill -0 "$BG_PID" 2>/dev/null; do
      "$1" "$_n"
      _n=$((_n + 1))
      sleep "$TICK"
    done
    _rc=0
    wait "$BG_PID" || _rc=$?
    BG_PID=""
    return "$_rc"
  }

  # Runs a command in the background with its output in the log, under the spinner.
  bg_run() {
    "$@" </dev/null >>"$LOG" 2>&1 &
    BG_PID=$!
    wait_bg spin
  }

  # Like bg_run, but DH_VERBOSE=1 shows the tool output live instead.
  run_step() {
    if [ "${DH_VERBOSE:-}" != "1" ]; then
      bg_run "$@"
      return
    fi
    end_line
    "$@" </dev/null &
    BG_PID=$!
    _rc=0
    wait "$BG_PID" || _rc=$?
    BG_PID=""
    return "$_rc"
  }

  fetch() {
    if has curl; then
      curl -fsSL --proto '=https' -o "$2" "$1" </dev/null 2>>"$LOG"
    else
      wget -q -O "$2" "$1" </dev/null 2>>"$LOG"
    fi
  }

  # Prints the Content-Length of the last response after redirects when it succeeded, or nothing.
  remote_size() {
    _pick='$1 ~ /^HTTP\// { ok = ($2 ~ /^2/); n = "" } ok && tolower($1) == "content-length:" { n = $2 } END { print n }'
    if has curl; then
      curl -fsSIL --max-time 10 --proto '=https' "$1" </dev/null 2>/dev/null | tr -d '\r' | awk "$_pick"
    else
      wget --spider -S -T 10 "$1" </dev/null 2>&1 | tr -d '\r' | awk "$_pick"
    fi
  }

  download() {
    DL_TOTAL=$(remote_size "$1" || true)
    case "$DL_TOTAL" in '' | *[!0-9]*) DL_TOTAL=0 ;; esac
    fmt_mb "$DL_TOTAL"
    DL_TOTAL_MB=$MB
    DL_DEST=$2
    DL_MARK=25
    if has curl; then
      curl -fsSL --proto '=https' -o "$2" "$1" </dev/null 2>>"$LOG" &
    else
      wget -q -O "$2" "$1" </dev/null 2>>"$LOG" &
    fi
    BG_PID=$!
    wait_bg meter || return
    [ "$MODE" != plain ] || meter 0
  }

  sha256_of() {
    if has shasum; then
      shasum -a 256 "$1" | awk '{print $1}'
    else
      sha256sum "$1" | awk '{print $1}'
    fi
  }

  write_sum() { sha256_of "$TMP/$FILE" >"$TMP/actual.sha256"; }

  # Sets LINE to the SHA256SUMS.txt line whose file name ends with $1; stops unless exactly one does.
  sums_line() {
    matches=$(awk -v s="$1" 'length($2) >= length(s) && substr($2, length($2) - length(s) + 1) == s' "$TMP/SHA256SUMS.txt")
    count=$(printf '%s' "$matches" | grep -c . || true)
    [ "$count" -eq 1 ] || die "Expected one file ending in $1 in SHA256SUMS.txt, found $count."
    LINE=$matches
  }

  # The one line command to run this version again, with or without sudo ($1), carrying
  # the DH_ options you set. $2 overrides DH_FORMAT.
  rerun_cmd() {
    _url="$RELEASES/download/v$VERSION/install.sh"
    _env=""
    _fmt=${2:-${DH_FORMAT:-}}
    [ -z "$_fmt" ] || _env="$_env DH_FORMAT=$_fmt"
    [ -z "${DH_NO_LAUNCH:-}" ] || _env="$_env DH_NO_LAUNCH=$DH_NO_LAUNCH"
    [ -z "${DH_VERBOSE:-}" ] || _env="$_env DH_VERBOSE=$DH_VERBOSE"
    if has curl; then _get="curl -fsSL $_url"; else _get="wget -qO- $_url"; fi
    if [ "$1" = sudo ]; then
      printf '  %s | sudo%s sh' "$_get" "$_env"
    else
      printf '  %s |%s sh' "$_get" "$_env"
    fi
  }

  case "$VERSION$REPO" in
    *__DH_*) die "This is a template. Run it from a release URL." ;;
  esac

  step_start "Checking your system"

  IS_ROOT=0
  [ "$(id -u)" -ne 0 ] || IS_ROOT=1
  VIA_SUDO=0
  AS_USER=""
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    VIA_SUDO=1
    AS_USER="sudo -u $SUDO_USER"
  fi

  OS=$(uname -s)
  case "$OS" in
    Darwin)
      if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
        SUFFIX="_aarch64.app.tar.gz"
        SYSTEM="macOS on Apple Silicon"
      else
        SUFFIX="_x64.app.tar.gz"
        SYSTEM="macOS on Intel"
      fi
      if [ ! -w /Applications ] && [ "$IS_ROOT" = 0 ]; then
        die "Installing to /Applications needs admin rights. Run it again with sudo:" "$(rerun_cmd sudo)"
      fi
      HOW="to /Applications"
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

  NO_FUSE=0

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
    else
      case "$PM" in
        apt-get) FORMAT="deb" ;;
        dnf | yum | zypper) FORMAT="rpm" ;;
        *) FORMAT="appimage" ;;
      esac
    fi

    if [ "$FORMAT" != "appimage" ] && [ "$IS_ROOT" = 0 ]; then
      die "Installing the .$FORMAT needs root. Run it again with sudo:" "$(rerun_cmd sudo)" \
        "Or install the AppImage for your user, no sudo needed:" "$(rerun_cmd "" appimage)"
    fi
    if [ "$FORMAT" = "appimage" ] && [ "$VIA_SUDO" = 1 ]; then
      die "The AppImage installs for your user. Run it again without sudo:" "$(rerun_cmd "")"
    fi

    case "$FORMAT" in
      deb)
        SUFFIX="_amd64.deb"
        SYSTEM="Linux x86_64, .deb via apt-get"
        HOW="the .deb with apt-get"
        ;;
      rpm)
        SUFFIX=".x86_64.rpm"
        SYSTEM="Linux x86_64, .rpm via $PM"
        HOW="the .rpm with $PM"
        ;;
      appimage)
        SUFFIX="_amd64.AppImage"
        SYSTEM="Linux x86_64, AppImage"
        HOW="the AppImage"
        ;;
    esac
  fi

  step_done "Checked your system, $SYSTEM"

  # Temp folder
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/dh-studio.XXXXXX")
  chmod 755 "$TMP"
  LOG="$TMP/install.log"
  : >"$LOG"

  # Download
  step_start "Downloading DH Studio $VERSION"
  BASE="$RELEASES/download/v$VERSION"
  fetch "$BASE/SHA256SUMS.txt" "$TMP/SHA256SUMS.txt" || die_log "Download failed: $BASE/SHA256SUMS.txt"
  sums_line "$SUFFIX"
  EXPECTED=$(printf '%s' "$LINE" | awk '{print $1}')
  FILE=$(printf '%s' "$LINE" | awk '{print $2}')
  download "$BASE/$FILE" "$TMP/$FILE" || die_log "Download failed: $BASE/$FILE"
  fmt_mb "$(($(wc -c <"$TMP/$FILE") + 0))"
  step_done "Downloaded DH Studio $VERSION, $MB MB"

  # Verify
  step_start "Verifying the download"
  bg_run write_sum || die_log "Couldn't compute the checksum of $FILE."
  ACTUAL=$(cat "$TMP/actual.sha256")
  [ "$ACTUAL" = "$EXPECTED" ] || die "Checksum mismatch for $FILE. Nothing was installed."
  chmod 644 "$TMP/$FILE"
  step_done "Verified the download"

  # Quit a running app, as the user who ran sudo when there is one.
  if [ "$OS" = "Darwin" ]; then
    is_running() { [ "$($AS_USER osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" = "true" ]; }
    ask_quit() { $AS_USER osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true; }
  else
    is_running() { has pgrep && pgrep -x dh-studio >/dev/null 2>&1; }
    ask_quit() { $AS_USER pkill -TERM -x dh-studio 2>/dev/null || true; }
  fi

  quit_app() {
    ask_quit
    _w=0
    while is_running; do
      [ "$_w" -lt 20 ] || return 1
      sleep 1
      _w=$((_w + 1))
    done
  }

  if is_running; then
    step_start "Quitting DH Studio"
    bg_run quit_app || die "DH Studio is still open. Quit it and run the command again."
    step_done "Quit DH Studio"
  fi

  # Install. These run in the background under an || list, where set -e doesn't apply,
  # so each chains its commands with && to stop at the first failure.
  mac_copy() {
    NEW="/Applications/.DH Studio.app.new"
    rm -rf "$NEW" &&
      ditto "$TMP/x/DH Studio.app" "$NEW" &&
      rm -rf "$MAC_APP" &&
      mv "$NEW" "$MAC_APP" || return 1
    xattr -dr com.apple.quarantine "$MAC_APP" 2>/dev/null || true
  }

  # rpm install refuses an older version than the one installed, so fall back to downgrade.
  rpm_install() {
    if [ "$PM" = "zypper" ]; then
      zypper --non-interactive install --allow-unsigned-rpm --oldpackage "$TMP/$FILE"
      return
    fi
    name=$(rpm -qp --qf '%{NAME}' "$TMP/$FILE" 2>/dev/null)
    want=$(rpm -qp --qf '%{VERSION}-%{RELEASE}' "$TMP/$FILE" 2>/dev/null)
    "$PM" install -y "$TMP/$FILE" || true
    if [ "$(rpm -q --qf '%{VERSION}-%{RELEASE}' "$name" 2>/dev/null)" != "$want" ]; then
      "$PM" downgrade -y "$TMP/$FILE"
    fi
  }

  place_appimage() {
    mkdir -p "$(dirname "$APPIMAGE_PATH")" "$(dirname "$DESKTOP_FILE")" &&
      cp "$TMP/$FILE" "$APPIMAGE_PATH.new" &&
      chmod 755 "$APPIMAGE_PATH.new" &&
      mv "$APPIMAGE_PATH.new" "$APPIMAGE_PATH"
  }

  extract_icon() {
    cd "$TMP" && "$APPIMAGE_PATH" --appimage-extract 'usr/share/icons/hicolor/*/apps/*.png'
  }

  step_start "Installing $HOW"
  if [ "$OS" = "Darwin" ]; then
    mkdir "$TMP/x"
    run_step tar -xzf "$TMP/$FILE" -C "$TMP/x" || die_log "Couldn't unpack $FILE."
    [ -d "$TMP/x/DH Studio.app" ] || die "$FILE doesn't contain DH Studio.app."
    run_step mac_copy || die_log "Couldn't copy DH Studio into /Applications."
    INSTALLED="$MAC_APP"
  else
    case "$FORMAT" in
      deb)
        run_step apt-get install -y --allow-downgrades "$TMP/$FILE" || die_log "apt-get couldn't install $FILE."
        INSTALLED="/usr/bin/dh-studio"
        ;;
      rpm)
        run_step rpm_install || die_log "$PM couldn't install $FILE."
        INSTALLED="/usr/bin/dh-studio"
        ;;
      appimage)
        run_step place_appimage || die_log "Couldn't copy the AppImage to $APPIMAGE_PATH."

        ICON_LINE=""
        if run_step extract_icon; then
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
          NO_FUSE=1
        fi
        ;;
    esac
  fi
  step_done "Installed $HOW"
  [ "$NO_FUSE" = 0 ] || note "The AppImage needs libfuse2 to run, which isn't installed. Add it with: $fuse_cmd"

  fmt_time $(($(date +%s) - START))
  if [ "$MODE" = plain ]; then
    printf 'ok DH Studio %s installed in %s\n' "$VERSION" "$T"
  else
    printf '%s%s%s %sDH Studio %s installed in %s%s\n' "$C_GREEN" "$OK_MARK" "$C_OFF" "$C_BOLD" "$VERSION" "$T" "$C_OFF"
  fi
  printf '  at %s\n' "$INSTALLED"

  # Launch
  if [ "${DH_NO_LAUNCH:-}" = "1" ]; then
    note "Not opening DH Studio because DH_NO_LAUNCH=1."
    return 0
  fi

  if [ "$OS" = "Darwin" ]; then
    if [ "$IS_ROOT" = 1 ] && [ "$VIA_SUDO" = 0 ]; then
      note "Open DH Studio from Applications."
      return 0
    fi
    step_start "Opening DH Studio"
    $AS_USER open "$MAC_APP" </dev/null || die "Couldn't open DH Studio. Open it from Applications."
    step_done "Opened DH Studio"
    return 0
  fi

  if [ "$NO_FUSE" = "1" ]; then
    note "Not opening DH Studio until libfuse2 is installed. Then open it from your app menu."
    return 0
  fi

  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    note "No desktop session found, so not opening DH Studio."
    return 0
  fi

  # Through sudo, open it as that user with their display, never as root.
  if [ "$VIA_SUDO" = 1 ]; then
    set -- sudo -u "$SUDO_USER" env
    [ -z "${DISPLAY:-}" ] || set -- "$@" "DISPLAY=$DISPLAY"
    [ -z "${WAYLAND_DISPLAY:-}" ] || set -- "$@" "WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
    set -- "$@" "XDG_RUNTIME_DIR=/run/user/$(id -u "$SUDO_USER")" nohup "$INSTALLED"
  else
    set -- nohup "$INSTALLED"
  fi
  step_start "Opening DH Studio"
  "$@" </dev/null >/dev/null 2>&1 &
  step_done "Opened DH Studio"
}

main "$@"
