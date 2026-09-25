# Downloads shinchiro's libmpv build into vendor/, where debug builds look for it.
param(
  [string]$Tag = 'latest'
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null

$api = 'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases'
$release = if ($Tag -eq 'latest') { Invoke-RestMethod "$api/latest" } else { Invoke-RestMethod "$api/tags/$Tag" }
$asset = $release.assets | Where-Object { $_.name -match '^mpv-dev-x86_64-\d' } | Select-Object -First 1
if (-not $asset) { throw "No mpv-dev-x86_64 asset in release $($release.tag_name)" }

$archive = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name)"
Invoke-WebRequest $asset.browser_download_url -OutFile $archive

& 7z e $archive "-o$vendor" libmpv-2.dll -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw '7z failed; is 7-Zip on PATH?' }
Remove-Item $archive
Set-Content (Join-Path $vendor 'libmpv.version') $release.tag_name
Write-Host "libmpv-2.dll ($($release.tag_name)) is in $vendor"
