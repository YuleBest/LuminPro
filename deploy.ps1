# LuminPro 一键构建部署脚本
# 用法: .\deploy.ps1 [-Message "commit message"]
param(
    [string]$Message = "chore: update"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = "YuleBest/LuminPro"
$distDir = Join-Path $PSScriptRoot ".dist"

# ── 1. git add + commit + push ────────────────────────────────────────────────
Write-Host "`n[1/4] 提交并推送..." -ForegroundColor Cyan

$dirty = git status --porcelain
if (-not $dirty) {
    Write-Host "      工作区无改动，仍继续等待最新 Run（若需强制触发请手动改动文件）" -ForegroundColor Yellow
} else {
    git add -A
    git commit -m $Message
    git push
    Write-Host "      推送完成" -ForegroundColor Green
}

# ── 2. 取最新触发的 Run ID（等待 CI 开始排队） ──────────────────────────────
Write-Host "`n[2/4] 等待 GitHub Actions 开始..." -ForegroundColor Cyan

$commitSha = git rev-parse HEAD
$runId = $null
$waited = 0

while (-not $runId) {
    Start-Sleep -Seconds 3
    $waited += 3
    if ($waited -gt 60) {
        Write-Error "等待超时：60 秒内未找到对应 Run，请检查 Actions 是否已触发。"
    }
    $runId = gh run list --repo $repo --commit $commitSha --limit 1 --json databaseId -q ".[0].databaseId" 2>$null
}

Write-Host "      Run ID: $runId" -ForegroundColor Green

# ── 3. 等待 CI 完成 ───────────────────────────────────────────────────────────
Write-Host "`n[3/4] 等待构建完成（可能需要数分钟）..." -ForegroundColor Cyan

$spinChars = '|', '/', '-', '\'
$spinIdx = 0
while ($true) {
    Start-Sleep -Seconds 5
    $json = gh run view $runId --repo $repo --json status,conclusion 2>$null | ConvertFrom-Json
    $status = $json.status
    $conclusion = $json.conclusion

    $spin = $spinChars[$spinIdx % $spinChars.Count]
    $spinIdx++
    Write-Host "`r  $spin  状态: $status   " -NoNewline

    if ($status -eq "completed") {
        Write-Host ""
        if ($conclusion -ne "success") {
            Write-Error "构建失败（$conclusion），请前往 https://github.com/$repo/actions/runs/$runId 查看日志。"
        }
        break
    }
}

Write-Host "      构建成功！" -ForegroundColor Green

# ── 4. 下载 artifact 到 .dist ─────────────────────────────────────────────────
Write-Host "`n[4/4] 下载 artifact 到 .dist ..." -ForegroundColor Cyan

if (Test-Path $distDir) {
    Remove-Item $distDir -Recurse -Force
}
New-Item -ItemType Directory -Path $distDir | Out-Null

# gh run download 把 artifact 内容放入 --dir/<artifact-name>/ 子目录。
# artifact 内只有一个模块 zip，把它移到 .dist 根，删掉空子目录。
gh run download $runId --repo $repo --dir $distDir

$subdirs = @(Get-ChildItem $distDir -Directory)
if ($subdirs.Count -eq 1) {
    $sub = $subdirs[0].FullName
    Get-ChildItem $sub | Move-Item -Destination $distDir -Force
    Remove-Item $sub -Force
}

# 打印结果
$zipInDist = Get-ChildItem $distDir -Filter "*.zip" | Select-Object -First 1
Write-Host "`n完成！" -ForegroundColor Green
Write-Host "  本地目录 : $distDir" -ForegroundColor White
Write-Host "  Actions  : https://github.com/$repo/actions/runs/$runId" -ForegroundColor White
if ($zipInDist) {
    Write-Host "  ZIP 文件  : $($zipInDist.FullName)" -ForegroundColor White
}
