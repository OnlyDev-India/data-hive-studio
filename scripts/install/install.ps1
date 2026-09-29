# DH Studio installer for Windows (PowerShell 5.1 or newer):
#   irm https://github.com/OnlyDev-India/data-hive-studio/releases/latest/download/install.ps1 | iex
# Options: $env:DH_NO_LAUNCH=1, $env:DH_SILENT=1

# Everything runs inside this script block, so a download cut off halfway runs nothing.
# It never calls exit, which would close the PowerShell window it was piped into.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    $Version = '__DH_VERSION__'
    $Repo = '__DH_REPO__'
    $Releases = "https://github.com/$Repo/releases"
    $Suffix = '_x64-setup.exe'
    $Tmp = $null
    $Total = [Diagnostics.Stopwatch]::StartNew()

    # Output mode: fancy (Windows Terminal, VS Code), ascii (legacy console) or plain (redirected).
    # Glyphs come from char codes so this file stays ASCII for irm on PowerShell 5.1.
    $Plain = [Console]::IsOutputRedirected -or $env:TERM -eq 'dumb'
    $Fancy = -not $Plain -and ($env:WT_SESSION -or $env:TERM_PROGRAM)
    $UseColor = -not $Plain -and -not $env:NO_COLOR
    if ($Fancy) {
        $OkMark = [string][char]0x2713
        $FailMark = [string][char]0x2717
        $Frames = @(0x280B, 0x2819, 0x2839, 0x2838, 0x283C, 0x2834, 0x2826, 0x2827, 0x2807, 0x280F) | ForEach-Object { [string][char]$_ }
    } else {
        $OkMark = 'ok'
        $FailMark = 'x'
        $Frames = @('|', '/', '-', '\')
    }
    $Cols = 80
    if (-not $Plain) {
        try {
            $w = $Host.UI.RawUI.WindowSize.Width
            if ($w -gt 0) { $Cols = $w }
        } catch { }
    }

    # Shared through a hashtable, since functions can't assign this block's variables.
    $ui = @{ Step = $null; Watch = $null; LastOut = 0; LastLen = 0; Frame = 0; CursorHidden = $false; Mark = 25; BarOpen = $false; BarLen = 0 }

    function Format-Duration([TimeSpan]$t) {
        $s = [int][Math]::Floor($t.TotalSeconds)
        if ($s -lt 1) { return '<1s' }
        if ($s -lt 60) { return "${s}s" }
        '{0}m {1:00}s' -f [int][Math]::Floor($s / 60), ($s % 60)
    }

    function Format-MB([long]$bytes) {
        ($bytes / 1MB).ToString('0.0', [Globalization.CultureInfo]::InvariantCulture)
    }

    function Write-Part([string]$text, $color) {
        if ($UseColor -and $color) {
            Write-Host $text -NoNewline -ForegroundColor $color
        } else {
            Write-Host $text -NoNewline
        }
    }

    function Set-Cursor([bool]$visible) {
        try {
            [Console]::CursorVisible = $visible
            $ui.CursorHidden = -not $visible
        } catch { }
    }

    # Redraws the open step line with a tail (spinner or meter), cut to fit and padded over the last draw.
    function Show-Line([string]$tail) {
        $room = $Cols - 6 - $tail.Length
        $label = $ui.Step
        if ($label.Length -gt $room) {
            $label = if ($room -gt 3) { $label.Substring(0, $room - 3) + '...' } else { '' }
        }
        $rest = " $label $tail"
        $len = 3 + $rest.Length
        Write-Host "`r" -NoNewline
        Write-Part '==>' 'Blue'
        Write-Host ($rest + (' ' * [Math]::Max(0, $ui.LastLen - $len))) -NoNewline
        $ui.LastLen = $len
    }

    function Clear-Line {
        Write-Host ("`r" + (' ' * $ui.LastLen) + "`r") -NoNewline
        $ui.LastLen = 0
    }

    # A bar $width wide for $pct percent, like [=====>     ].
    function Format-Bar([int]$pct, [int]$width) {
        $fill = [int][Math]::Floor($pct * $width / 100)
        if ($fill -ge $width) { return '[' + ('=' * $width) + ']' }
        '[' + ('=' * $fill) + '>' + (' ' * ($width - $fill - 1)) + ']'
    }

    # Redraws the download bar on its own line under the open step line.
    function Show-Bar([string]$text) {
        if (-not $ui.BarOpen) {
            Write-Host ''
            $ui.BarOpen = $true
            $ui.BarLen = 0
        }
        $line = "    $text"
        Write-Host ("`r" + $line + (' ' * [Math]::Max(0, $ui.BarLen - $line.Length))) -NoNewline
        $ui.BarLen = $line.Length
    }

    # Clears the bar line and moves back up to the step line.
    function Close-Bar {
        if (-not $ui.BarOpen) { return }
        Write-Host ("`r" + (' ' * $ui.BarLen) + "`r") -NoNewline
        try { [Console]::SetCursorPosition(0, [Console]::CursorTop - 1) } catch { }
        $ui.BarOpen = $false
    }

    function Start-Step([string]$label) {
        $ui.Step = $label
        $ui.Watch = [Diagnostics.Stopwatch]::StartNew()
        $ui.LastOut = 0
        $ui.Frame = 0
        if ($Plain) {
            Write-Host "==> $label"
        } else {
            Set-Cursor $false
            Show-Line ''
        }
    }

    function Write-StepEnd([string]$mark, $color, [string]$label, [string]$time) {
        if ($Plain) {
            Write-Host "$mark $label ($time)"
        } else {
            Close-Bar
            Clear-Line
            Write-Part $mark $color
            Write-Host " $label " -NoNewline
            Write-Part "($time)" 'DarkGray'
            Write-Host ''
            Set-Cursor $true
        }
        $ui.Step = $null
    }

    function Complete-Step([string]$label) {
        Write-StepEnd $OkMark 'Green' $label (Format-Duration $ui.Watch.Elapsed)
    }

    function Stop-Step([string]$time) {
        if (-not $ui.Step) { return }
        if (-not $time) { $time = Format-Duration $ui.Watch.Elapsed }
        Write-StepEnd $FailMark 'Red' $ui.Step $time
    }

    function Write-Note([string]$text) { Write-Host "  Note: $text" }

    # One Write-Host in plain mode, so a redirected log keeps it on one line.
    function Write-Marked([string]$mark, $color, [string]$text) {
        if ($Plain) {
            Write-Host "$mark $text"
        } else {
            Write-Part $mark $color
            Write-Host " $text"
        }
    }

    # Plain mode: prints "still working" when nothing has printed for 15 seconds.
    function Write-Heartbeat {
        $now = [Math]::Floor($ui.Watch.Elapsed.TotalSeconds)
        if ($now - $ui.LastOut -ge 15) {
            Write-Host "    still working ($(Format-Duration $ui.Watch.Elapsed))"
            $ui.LastOut = $now
        }
    }

    function Invoke-Tick {
        if ($Plain) {
            Write-Heartbeat
        } else {
            Show-Line $Frames[$ui.Frame % $Frames.Count]
            $ui.Frame++
        }
    }

    function Show-Meter([long]$got, $size) {
        $mb = Format-MB $got
        if ($size -gt 0) {
            $pct = [Math]::Min(100, [int][Math]::Floor($got * 100 / $size))
            if ($Plain) {
                while ($ui.Mark -le 100 -and $pct -ge $ui.Mark) {
                    Write-Host ('    {0} {1,3}%' -f (Format-Bar $ui.Mark 30), $ui.Mark)
                    $ui.Mark += 25
                    $ui.LastOut = [Math]::Floor($ui.Watch.Elapsed.TotalSeconds)
                }
                Write-Heartbeat
            } else {
                $text = '{0,3}%  {1} / {2} MB' -f $pct, $mb, (Format-MB $size)
                $width = [Math]::Min(40, $Cols - 9 - $text.Length)
                if ($width -ge 10) { $text = (Format-Bar $pct $width) + '  ' + $text }
                Show-Bar $text
            }
        } elseif ($Plain) {
            $now = [Math]::Floor($ui.Watch.Elapsed.TotalSeconds)
            if ($now - $ui.LastOut -ge 15) {
                Write-Host "    $mb MB"
                $ui.LastOut = $now
            }
        } else {
            Show-Line "$mb MB"
        }
    }

    # Waits on a .NET task in 100 ms slices, so a stalled connection still ticks.
    function Wait-Task($task, [scriptblock]$onWait) {
        while ([Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]@($task), 100) -lt 0) { & $onWait }
        $task.GetAwaiter().GetResult()
    }

    # Streams a URL to a file with HttpClient, which stays fast on PowerShell 5.1, drawing
    # the meter every 100 ms when asked. Returns the byte count.
    function Get-File([string]$url, [string]$dest, [bool]$meter) {
        $client = $null
        $response = $null
        $in = $null
        $out = $null
        try {
            $client = New-Object System.Net.Http.HttpClient
            $client.Timeout = [TimeSpan]::FromMinutes(30)
            $response = Wait-Task ($client.GetAsync($url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead)) { Invoke-Tick }
            $null = $response.EnsureSuccessStatusCode()
            $size = $response.Content.Headers.ContentLength
            $in = Wait-Task ($response.Content.ReadAsStreamAsync()) { Invoke-Tick }
            $out = [IO.File]::Create($dest)
            $buffer = New-Object byte[] 81920
            [long]$got = 0
            $ui.Mark = 25
            $onWait = if ($meter) { { Show-Meter $got $size } } else { { Invoke-Tick } }
            $tick = [Diagnostics.Stopwatch]::StartNew()
            while (($n = Wait-Task ($in.ReadAsync($buffer, 0, $buffer.Length)) $onWait) -gt 0) {
                $out.Write($buffer, 0, $n)
                $got += $n
                if ($meter -and $tick.ElapsedMilliseconds -ge 100) {
                    Show-Meter $got $size
                    $tick.Restart()
                }
            }
            if ($meter -and $Plain) { Show-Meter $got $size }
            $got
        } catch {
            throw "Download failed: $url"
        } finally {
            if ($out) { $out.Dispose() }
            if ($in) { $in.Dispose() }
            if ($response) { $response.Dispose() }
            if ($client) { $client.Dispose() }
        }
    }

    function Test-Running { [bool](Get-Process -Name 'dh-studio' -ErrorAction SilentlyContinue) }

    function Find-InstalledExe {
        $entry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -eq 'DH Studio' } |
            Select-Object -First 1
        $dir = $null
        if ($entry -and $entry.InstallLocation) {
            $dir = $entry.InstallLocation.Trim('"')
        } elseif ($entry -and $entry.DisplayIcon) {
            $dir = Split-Path -Parent ($entry.DisplayIcon.Trim('"') -replace ',\d+$', '')
        } else {
            $dir = Join-Path $env:LOCALAPPDATA 'DH Studio'
        }
        Join-Path $dir 'dh-studio.exe'
    }

    $failed = $false
    try {
        if ("$Version$Repo" -like '*__DH_*') { throw 'This is a template. Run it from a release URL.' }

        Start-Step 'Checking your system'

        if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) {
            throw "This installer is for Windows. On macOS or Linux, run: curl -fsSL $Releases/latest/download/install.sh | sh"
        }

        # OS and CPU
        $arch = $null
        try {
            $arch = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
        } catch {
            $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        }
        $build = [Environment]::OSVersion.Version.Build
        $armNote = $false
        switch -Regex ($arch) {
            '^(X64|AMD64)$' { $system = 'Windows x64' }
            '^(Arm64|ARM64)$' {
                if ($build -lt 22000) {
                    throw "DH Studio needs Windows 11 on Arm PCs (this is Windows 10, build $build). See $Releases"
                }
                $system = 'Windows on Arm'
                $armNote = $true
            }
            default { throw "DH Studio needs 64 bit Windows (this PC reports $arch). See $Releases" }
        }
        Complete-Step "Checked your system, $system"
        if ($armNote) { Write-Note 'This is an Arm PC, so DH Studio runs as an x64 app through Windows emulation.' }

        # Temp folder
        $Tmp = Join-Path ([IO.Path]::GetTempPath()) ('dh-studio-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $Tmp | Out-Null

        # Download
        Start-Step "Downloading DH Studio $Version"
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Add-Type -AssemblyName System.Net.Http
        $base = "$Releases/download/v$Version"
        $sumsPath = Join-Path $Tmp 'SHA256SUMS.txt'
        $null = Get-File "$base/SHA256SUMS.txt" $sumsPath $false
        $found = @(Get-Content $sumsPath | ForEach-Object {
                $parts = $_.Trim() -split '\s+'
                if ($parts.Count -ge 2 -and $parts[1].EndsWith($Suffix)) { , $parts }
            })
        if ($found.Count -ne 1) {
            throw "Expected one file ending in $Suffix in SHA256SUMS.txt, found $($found.Count)."
        }
        $expected = $found[0][0]
        $file = $found[0][1]
        $setup = Join-Path $Tmp $file
        $bytes = Get-File "$base/$file" $setup $true
        Complete-Step "Downloaded DH Studio $Version, $(Format-MB $bytes) MB"

        # Verify
        Start-Step 'Verifying the download'
        $actual = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash
        if ($actual -ne $expected) { throw "Checksum mismatch for $file. Nothing was installed." }
        Unblock-File -Path $setup
        Complete-Step 'Verified the download'

        # Smart App Control
        $sac = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name 'VerifiedAndReputablePolicyState' -ErrorAction SilentlyContinue
        if ($sac -and @(1, 2) -contains $sac.VerifiedAndReputablePolicyState) {
            Write-Note "Smart App Control may block DH Studio because it isn't code signed yet. If it's blocked, see the README."
        }

        # Quit a running app
        if (Test-Running) {
            Start-Step 'Quitting DH Studio'
            Get-Process -Name 'dh-studio' -ErrorAction SilentlyContinue | ForEach-Object { $null = $_.CloseMainWindow() }
            while (Test-Running) {
                if ($ui.Watch.Elapsed.TotalSeconds -ge 20) { throw 'DH Studio is still open. Quit it and run the command again.' }
                for ($i = 0; $i -lt 10; $i++) {
                    Invoke-Tick
                    Start-Sleep -Milliseconds 100
                }
            }
            Complete-Step 'Quit DH Studio'
        }

        # Install. WaitForExit waits for the installer alone, not an app its Run box starts.
        if ($env:DH_SILENT -eq '1') {
            Start-Step 'Installing DH Studio'
            $proc = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru
        } else {
            Start-Step 'Installing DH Studio (finish the setup window to continue)'
            $proc = Start-Process -FilePath $setup -PassThru
        }
        $null = $proc.Handle
        while (-not $proc.WaitForExit(100)) { Invoke-Tick }
        if ($proc.ExitCode -ne 0) { throw "Install cancelled or failed (exit code $($proc.ExitCode))" }
        Complete-Step 'Installed DH Studio'

        $exe = Find-InstalledExe
        Write-Marked $OkMark 'Green' "DH Studio $Version installed in $(Format-Duration $Total.Elapsed)"
        Write-Host "  at $exe"

        # Launch
        if ($env:DH_NO_LAUNCH -eq '1') {
            Write-Note 'Not opening DH Studio because DH_NO_LAUNCH=1.'
        } else {
            Start-Step 'Opening DH Studio'
            for ($i = 0; $i -lt 20; $i++) {
                Invoke-Tick
                Start-Sleep -Milliseconds 100
            }
            if (-not (Test-Running)) { Start-Process -FilePath $exe }
            Complete-Step 'Opened DH Studio'
        }
    } catch {
        $failed = $true
        Stop-Step
        Write-Marked 'Error:' 'Red' $_.Exception.Message
        $global:LASTEXITCODE = 1
    } finally {
        if ($ui.CursorHidden) { Set-Cursor $true }
        if ($Tmp -and (Test-Path $Tmp)) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
        # Ctrl+C skips catch and lands here with the step still open.
        if (-not $failed) { try { Stop-Step 'cancelled' } catch { } }
    }
}
