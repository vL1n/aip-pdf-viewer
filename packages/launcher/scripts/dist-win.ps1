Param(
  [string]$OutDir = "dist-win"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$launcherRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$out = Join-Path $launcherRoot $OutDir
$bundle = Join-Path $out "bundle"

Write-Host "[launcher] repoRoot=$repoRoot"
Write-Host "[launcher] out=$out"

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
  -o (Join-Path $bundle "bin")

Copy-Item -Force (Join-Path $bundle "bin\aip-launcher.exe") (Join-Path $bundle "aip-launcher.exe")
Remove-Item -Recurse -Force (Join-Path $bundle "bin")

Write-Host "[launcher] zip..."
$zip = Join-Path $out "AIP-PDF-Viewer-win-x64.zip"
Compress-Archive -Path (Join-Path $bundle "*") -DestinationPath $zip
Write-Host "[launcher] done: $zip"


