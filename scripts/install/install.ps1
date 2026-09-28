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

    function Say($msg) { Write-Host $msg }

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

    try {
        if ("$Version$Repo" -like '*__DH_*') { throw 'This is a template. Run it from a release URL.' }

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
        switch -Regex ($arch) {
            '^(X64|AMD64)$' { }
            '^(Arm64|ARM64)$' {
                if ($build -lt 22000) {
                    throw "DH Studio needs Windows 11 on Arm PCs (this is Windows 10, build $build). See $Releases"
                }
                Say 'This is an Arm PC, so DH Studio runs as an x64 app through Windows emulation.'
            }
            default { throw "DH Studio needs 64 bit Windows (this PC reports $arch). See $Releases" }
        }

        # Temp folder
        $Tmp = Join-Path ([IO.Path]::GetTempPath()) ('dh-studio-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $Tmp | Out-Null

        # Download and verify
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $base = "$Releases/download/v$Version"
        Say "Downloading DH Studio $Version..."
        $sumsPath = Join-Path $Tmp 'SHA256SUMS.txt'
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt" -OutFile $sumsPath
        } catch {
            throw "Download failed: $base/SHA256SUMS.txt"
        }
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
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile $setup
        } catch {
            throw "Download failed: $base/$file"
        }
        $actual = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash
        if ($actual -ne $expected) { throw "Checksum mismatch for $file. Nothing was installed." }
        Unblock-File -Path $setup

        # Smart App Control
        $sac = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name 'VerifiedAndReputablePolicyState' -ErrorAction SilentlyContinue
        if ($sac -and @(1, 2) -contains $sac.VerifiedAndReputablePolicyState) {
            Say "Smart App Control may block DH Studio because it isn't code signed yet. If it's blocked, see the README."
        }

        # Quit a running app
        if (Test-Running) {
            Say 'Quitting DH Studio so it can be replaced...'
            Get-Process -Name 'dh-studio' -ErrorAction SilentlyContinue | ForEach-Object { $null = $_.CloseMainWindow() }
            $waited = 0
            while (Test-Running) {
                if ($waited -ge 20) { throw 'DH Studio is still open. Quit it and run the command again.' }
                Start-Sleep -Seconds 1
                $waited++
            }
        }

        # Install. WaitForExit waits for the installer alone, not an app its Run box starts.
        if ($env:DH_SILENT -eq '1') {
            $proc = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru
        } else {
            $proc = Start-Process -FilePath $setup -PassThru
        }
        $null = $proc.Handle
        $proc.WaitForExit()
        if ($proc.ExitCode -ne 0) { throw "Install cancelled or failed (exit code $($proc.ExitCode))" }

        $exe = Find-InstalledExe
        Say "DH Studio $Version is installed at $exe"

        # Launch
        if ($env:DH_NO_LAUNCH -ne '1') {
            Start-Sleep -Seconds 2
            if (-not (Test-Running)) { Start-Process -FilePath $exe }
        }
    } catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        $global:LASTEXITCODE = 1
    } finally {
        if ($Tmp -and (Test-Path $Tmp)) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
    }
}
