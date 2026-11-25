# FOMO desk pilot installer for Windows (PowerShell 5.1+ or 7). Run:
#   irm https://kaykefranco01-hash.github.io/desk-app/pilot/install.ps1 | iex
# Installs into %USERPROFILE%\.fomo-pilot : pilot.py, a Python venv, pilot.cmd. Then asks (locally, hidden) for the
# one-time install code and creates or imports the dedicated hot wallet. Nothing secret is in this script.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Base = if ($env:FOMO_PILOT_BASE) { $env:FOMO_PILOT_BASE } else { 'https://kaykefranco01-hash.github.io/desk-app/pilot' }
$OnWin = ($env:OS -eq 'Windows_NT')
$UserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$Dir = if ($env:FOMO_PILOT_HOME) { $env:FOMO_PILOT_HOME } else { Join-Path $UserHome '.fomo-pilot' }
Write-Host "FOMO pilot -> $Dir"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

foreach ($f in 'pilot.py', 'requirements.txt') {
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$f`?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -OutFile (Join-Path $Dir $f)
}

function Find-Python {
  foreach ($c in @(@('py', '-3'), @('python'), @('python3'), @('python3.12'))) {
    $exe = $c[0]; $rest = @($c | Select-Object -Skip 1)
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    try {
      $ok = & $exe @rest -c "import sys; print(int(sys.version_info >= (3, 10)))" 2>$null
      if ("$ok".Trim() -eq '1') { return ,@($c) }
    } catch { }
  }
  return $null
}

$py = Find-Python
if (-not $py) {
  Write-Host 'Python 3.10+ not found.'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $a = Read-Host 'Install Python 3.12 now with winget? [Y/n]'
    if ($a -notmatch '^[nN]') {
      winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
      $py = Find-Python
    }
  }
  if (-not $py) { throw 'Install Python 3.10+ from https://www.python.org/downloads/windows/ then run this again.' }
}
$pyExe = $py[0]; $pyArgs = @($py | Select-Object -Skip 1)
$venv = Join-Path $Dir 'venv'
$vpy = if ($OnWin) { Join-Path $venv 'Scripts\python.exe' } else { Join-Path $venv 'bin/python' }
if (-not (Test-Path $vpy)) {
  Write-Host 'Creating venv...'
  & $pyExe @pyArgs -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw 'venv creation failed' }
}
Write-Host 'Installing dependencies...'
& $vpy -m pip install --disable-pip-version-check -q --upgrade pip
& $vpy -m pip install --disable-pip-version-check -q -r (Join-Path $Dir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

# pilot.cmd: run pilot with the venv python from anywhere (arguments pass through: --race, --stop, --status)
$cmd = "@echo off`r`n`"%~dp0venv\Scripts\python.exe`" `"%~dp0pilot.py`" %*`r`nif errorlevel 1 if not `"%~1`"==`"--stop`" pause`r`n"
Set-Content -Path (Join-Path $Dir 'pilot.cmd') -Value $cmd -Encoding ASCII -NoNewline

# folder readable by this user only (wallet.json/desk.json/state.json get their own ACLs too)
if ($OnWin) { icacls $Dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null } else { chmod 700 $Dir }

if ($env:FOMO_PILOT_SKIP_SETUP -ne '1') {
  & $vpy (Join-Path $Dir 'pilot.py') setup
  if ($LASTEXITCODE -ne 0) { throw 'setup did not finish' }
}
Write-Host ''
Write-Host 'Done. Start the pilot (DRY by default):'
Write-Host "  & `"$Dir\pilot.cmd`""
Write-Host 'Restart (copy-paste):'
Write-Host "  & `"$Dir\pilot.cmd`" --stop; Start-Process `"$Dir\pilot.cmd`""
Write-Host 'Stop:'
Write-Host "  & `"$Dir\pilot.cmd`" --stop"
