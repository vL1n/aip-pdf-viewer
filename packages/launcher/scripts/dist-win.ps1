Param(
  [string]$OutDir = "dist-win",
  [string]$Version = $env:AIP_LAUNCHER_VERSION
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = "0.0.0-dev"
}

if ($Version.StartsWith("v")) {
  $Version = $Version.Substring(1)
}

function Get-LauncherFileVersion([string]$PackageVersion) {
  if ($PackageVersion -match '^(\d+)\.(\d+)\.(\d+)') {
    return "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
  }
  return "0.0.0.0"
}

$fileVersion = Get-LauncherFileVersion $Version

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$launcherRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$out = Join-Path $launcherRoot $OutDir
$bundle = Join-Path $out "bundle"
$launcherPublish = Join-Path $bundle "_publish_launcher"
$updaterPublish = Join-Path $bundle "_publish_updater"

Write-Host "[launcher] repoRoot=$repoRoot"
Write-Host "[launcher] out=$out"
Write-Host "[launcher] version=$Version fileVersion=$fileVersion"

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $bundle | Out-Null

Write-Host "[launcher] build web/server..."
pnpm -C $repoRoot --filter @aip/web build
pnpm -C $repoRoot --filter @aip/server build

Write-Host "[launcher] bundle server (dist + npm install --omit=dev)..."
$serverBundle = Join-Path $bundle "server"
New-Item -ItemType Directory -Force -Path $serverBundle | Out-Null

$serverDist = Join-Path $repoRoot "packages\server\dist"
if (!(Test-Path $serverDist)) {
  throw "server dist 不存在：$serverDist（请确认 pnpm -C repoRoot --filter @aip/server build 已成功）"
}
Copy-Item -Recurse -Force $serverDist (Join-Path $serverBundle "dist")
Copy-Item -Force (Join-Path $repoRoot "packages\server\package.json") (Join-Path $serverBundle "package.json")

Push-Location $serverBundle
try {
  # 生成不依赖 pnpm symlink/junction 的 node_modules（zip 解压后也能正常运行）
  npm install --omit=dev --no-audit --no-fund
} finally {
  Pop-Location
}

Write-Host "[launcher] copy web dist..."
$webDist = Join-Path $repoRoot "packages\web\dist"
if (!(Test-Path $webDist)) {
  throw "web dist 不存在：$webDist（请确认 pnpm -C repoRoot --filter @aip/web build 已成功）"
}
Copy-Item -Recurse -Force $webDist (Join-Path $bundle "web")

Write-Host "[launcher] copy node.exe..."
$nodeExe = (Get-Command node).Source
New-Item -ItemType Directory -Force -Path (Join-Path $bundle "node") | Out-Null
Copy-Item -Force $nodeExe (Join-Path $bundle "node\node.exe")

Write-Host "[launcher] build launcher exe (single-file)..."
dotnet publish (Join-Path $launcherRoot "src\AipLauncher\AipLauncher.csproj") `
  -c Release -r win-x64 --self-contained true `
  /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true `
  /p:Version=$Version /p:InformationalVersion=$Version /p:AssemblyVersion=$fileVersion /p:FileVersion=$fileVersion `
  -o $launcherPublish

Copy-Item -Force (Join-Path $launcherPublish "aip-launcher.exe") (Join-Path $bundle "aip-launcher.exe")

Write-Host "[launcher] build updater exe (single-file)..."
dotnet publish (Join-Path $launcherRoot "src\AipUpdater\AipUpdater.csproj") `
  -c Release -r win-x64 --self-contained true `
  /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true `
  /p:Version=$Version /p:InformationalVersion=$Version /p:AssemblyVersion=$fileVersion /p:FileVersion=$fileVersion `
  -o $updaterPublish

Copy-Item -Force (Join-Path $updaterPublish "aip-updater.exe") (Join-Path $bundle "aip-updater.exe")

Remove-Item -Recurse -Force $launcherPublish
Remove-Item -Recurse -Force $updaterPublish

Write-Host "[launcher] zip..."
$zip = Join-Path $out "AIP-PDF-Viewer-win-x64.zip"
Compress-Archive -Path (Join-Path $bundle "*") -DestinationPath $zip

Write-Host "[launcher] write checksums..."
$checksumPath = Join-Path $out "SHA256SUMS.txt"
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path $checksumPath -Encoding ASCII -Value "$hash *$(Split-Path $zip -Leaf)"

Write-Host "[launcher] done: $zip"

