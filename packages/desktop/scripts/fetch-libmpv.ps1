# Downloads the libmpv that libmpv.pin names into vendor/<arch>/, where debug builds and
# packaging look for it. -Tag fetches another shinchiro release, unchecked.
param(
  [ValidateSet('x86_64', 'aarch64')]
  [string]$Arch = 'x86_64',
  [string]$Tag
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pin = @{}
Get-Content (Join-Path $root 'libmpv.pin') |
  Where-Object { $_ -match '^(\w+)=(\S+)$' } |
  ForEach-Object { $pin[$Matches[1]] = $Matches[2] }
$pinned = -not $Tag
if ($pinned) { $Tag = $pin['tag'] }

$vendor = Join-Path $root "vendor/$Arch"
New-Item -ItemType Directory -Force $vendor | Out-Null

$headers = @{}
if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
$api = "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/tags/$Tag"
try {
  $release = Invoke-RestMethod $api -Headers $headers
} catch {
  throw "libmpv release $Tag was not found at shinchiro/mpv-winbuild-cmake; bump libmpv.pin. ($_)"
}
$asset = $release.assets | Where-Object { $_.name -match "^mpv-dev-$Arch-\d" } | Select-Object -First 1
if (-not $asset) { throw "No mpv-dev-$Arch archive in release $Tag" }

$archive = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name)"
Invoke-WebRequest $asset.browser_download_url -OutFile $archive
if ($pinned) {
  $hash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $pin[$Arch]) { throw "$($asset.name) has SHA-256 $hash, not the pinned $($pin[$Arch])" }
}

& 7z e $archive "-o$vendor" libmpv-2.dll -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw '7z failed; is 7-Zip on PATH?' }
Remove-Item $archive
Set-Content (Join-Path $vendor 'libmpv.version') $Tag
Write-Host "libmpv-2.dll ($Tag, $Arch) is in $vendor"
