# Removes the Miracle - Video Downloader companion app for the current user.
#
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1

$HostName = 'com.miracle.videodownloader'
$InstallDir = Join-Path $env:LOCALAPPDATA 'MiracleVideoDownloader'

foreach ($root in 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
                  'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
                  'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts') {
    $key = Join-Path $root $HostName
    if (Test-Path $key) { Remove-Item -Force $key }
}

Get-Process MiracleHost -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }

Write-Host 'Companion app removed.' -ForegroundColor Green
