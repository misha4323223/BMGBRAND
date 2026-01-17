# PowerShell Script for Booomerangs (BMGBRAND) Category Synchronization
# This script sends a request to the backend API to trigger category mapping and backfill.

# Configuration
$BaseUrl = "https://booomerangs-bmgbrand.replit.app" # Replace with your actual domain if different
$ApiKey = "bmg-secret-123" # Must match SYNC_API_KEY if configured, or use basic auth for 1c-exchange

Write-Host "Starting Category Synchronization for Booomerangs..." -ForegroundColor Cyan

# 1. Trigger Category Backfill
$BackfillUrl = "$BaseUrl/api/backfill-categories"
Write-Host "Sending request to $BackfillUrl..."

try {
    $Response = Invoke-RestMethod -Uri $BackfillUrl -Method Post -ContentType "application/json"
    Write-Host "Success: $($Response.message)" -ForegroundColor Green
    if ($Response.count) {
        Write-Host "Updated $($Response.count) products." -ForegroundColor Green
    }
} catch {
    Write-Error "Failed to synchronize categories: $_"
}

# 2. Trigger Sync from Storage (Optional, if using Yandex Storage)
$SyncUrl = "$BaseUrl/api/sync-from-storage"
Write-Host "`nDo you want to sync products from Yandex Storage? (Y/N)"
$choice = Read-Host
if ($choice -eq 'Y' -or $choice -eq 'y') {
    Write-Host "Triggering sync from storage..."
    try {
        $SyncResponse = Invoke-RestMethod -Uri $SyncUrl -Method Post -ContentType "application/json"
        Write-Host "Sync completed successfully." -ForegroundColor Green
    } catch {
        Write-Error "Failed to sync from storage: $_"
    }
}

Write-Host "`nSynchronization process finished." -ForegroundColor Cyan
pause
