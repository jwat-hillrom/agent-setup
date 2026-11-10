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

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$MinNodeMajor = 18

function Invoke-Native {
    # Windows PowerShell 5.1 turns native stderr into terminating errors; judge by exit code instead.
    $ErrorActionPreference = 'Continue'
    & $args[0] @($args | Select-Object -Skip 1)
    if ($LASTEXITCODE -ne 0) { throw "'$($args -join ' ')' failed with exit code $LASTEXITCODE" }
}

function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
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
    Invoke-Native git -C $ToolDir pull --ff-only --quiet
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ToolDir) | Out-Null
    Invoke-Native git clone --quiet --depth 1 $Repo $ToolDir
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$shim = Join-Path $BinDir 'agent-setup.cmd'
Set-Content -Path $shim -Encoding ASCII -Value "@echo off`r`nnode `"$ToolDir\agent-setup.mjs`" %*"

if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($userPath -split ';') -notcontains $BinDir) {
        [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $BinDir), 'User')
        Update-SessionPath
    }
}

Write-Host "agent-setup installed. Open a new terminal, go to a repository, and run: agent-setup"
Write-Host "On first run you may be asked to sign in to GitHub so the private Baxter skills can be fetched."
Write-Host "The Taste skill's own scripts also need Node 22+ and Chrome, Edge or Chromium."
