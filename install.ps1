#Requires -Version 5.1
<#
.SYNOPSIS
  Installs agent-setup on this workstation: checks Git and Node, fetches the tool, adds an `agent-setup` command.

.DESCRIPTION
  Safe to re-run: it updates the tool clone and rewrites the shim.
  Missing Git or Node is installed with winget after you confirm (or with -Yes).

.EXAMPLE
  .\install.ps1
.EXAMPLE
  irm https://raw.githubusercontent.com/jwat-hillrom/agent-setup/main/install.ps1 | iex
#>
[CmdletBinding()]
param(
    [string]$Repo = $(if ($env:AGENT_SETUP_REPO) { $env:AGENT_SETUP_REPO } else { 'https://github.com/jwat-hillrom/agent-setup.git' }),
    [string]$ToolDir = (Join-Path $env:LOCALAPPDATA 'agent-setup\tool'),
    [string]$BinDir = (Join-Path $env:LOCALAPPDATA 'agent-setup\bin'),
    [switch]$Yes,
    [switch]$NoPath
)

# Everything runs in a child scope so `irm | iex` does not leak strict mode or $ErrorActionPreference into the caller's session.
& {
param([string]$Repo, [string]$ToolDir, [string]$BinDir, [bool]$Yes, [bool]$NoPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$MinNodeMajor = 20

function Invoke-Native {
    # Windows PowerShell 5.1 turns native stderr into terminating errors; judge by exit code instead.
    $ErrorActionPreference = 'Continue'
    & $args[0] @($args | Select-Object -Skip 1)
    if ($LASTEXITCODE -ne 0) { throw "'$($args -join ' ')' failed with exit code $LASTEXITCODE" }
}

function Update-SessionPath {
    $parts = @($env:Path -split ';') + @([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';') + @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';')
    $env:Path = (($parts | Where-Object { $_ } | Select-Object -Unique) -join ';')
}

function Install-WithWinget([string]$Id, [string]$Label) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$Label is required and winget is not available. Install $Label manually, then re-run."
    }
    if (-not $Yes) {
        $answer = Read-Host "$Label is missing. Install it with winget? [Y/n]"
        if ($answer -match '^(n|no)$') { throw "$Label is required." }
    }
    Invoke-Native winget install --id $Id -e --source winget --accept-package-agreements --accept-source-agreements
    Update-SessionPath
}

function Get-NodeMajor {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
    $v = (& node -p 'process.versions.node') 2>$null
    if ($v -match '^(\d+)\.') { return [int]$Matches[1] }
    return 0
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Install-WithWinget 'Git.Git' 'Git' }
if ((Get-NodeMajor) -lt $MinNodeMajor) { Install-WithWinget 'OpenJS.NodeJS.LTS' "Node.js $MinNodeMajor or newer" }
if ((Get-NodeMajor) -lt $MinNodeMajor) { throw "Node.js $MinNodeMajor or newer is not on PATH yet. Open a new terminal and re-run." }

if (Test-Path -LiteralPath (Join-Path $ToolDir '.git')) {
    try { Invoke-Native git -C $ToolDir pull --ff-only --quiet }
    catch { Write-Warning "Could not update the existing tool clone, continuing with what is installed: $_" }
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ToolDir) | Out-Null
    Invoke-Native git clone --quiet --depth 1 -- $Repo $ToolDir
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$shim = Join-Path $BinDir 'agent-setup.cmd'
$cmdPath = $ToolDir.Replace('%', '%%')
Set-Content -LiteralPath $shim -Encoding ASCII -Value "@echo off`r`nnode `"$cmdPath\agent-setup.mjs`" %*"

if (-not $NoPath) {
    # Read the raw registry value so %VARS% in the user's PATH are preserved, then tell running apps about the change.
    $key = if ($env:AGENT_SETUP_ENV_KEY) { $env:AGENT_SETUP_ENV_KEY } else { 'HKCU:\Environment' }
    $raw = [string](Get-Item -LiteralPath $key).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
    $entries = @($raw -split ';' | Where-Object { $_ })
    $present = $entries | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ieq $BinDir.TrimEnd('\') }
    if (-not $present) {
        Set-ItemProperty -LiteralPath $key -Name Path -Value (($entries + $BinDir) -join ';') -Type ExpandString
        Add-Type -Namespace AgentSetup -Name Native -MemberDefinition '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
        $result = [UIntPtr]::Zero
        [void][AgentSetup.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
        Update-SessionPath
    }
}

Write-Host "agent-setup installed. Open a new terminal (restart VS Code to use it from its terminal), go to a repository, and run: agent-setup"
Write-Host "On first run you may be asked to sign in to GitHub so the private Baxter skills can be fetched."
Write-Host "The Taste skill's own scripts also need Node 22+ and Chrome, Edge or Chromium."
} -Repo $Repo -ToolDir $ToolDir -BinDir $BinDir -Yes $Yes.IsPresent -NoPath $NoPath.IsPresent
