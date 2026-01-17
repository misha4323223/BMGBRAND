# PowerShell Script for Booomerangs (BMGBRAND) Category Synchronization
# This script sends a request to the backend API to trigger category mapping and backfill.

# Configuration
$BaseUrl = "https://booomerangs-bmgbrand.replit.app" # Replace with your actual domain if different
$ApiKey = "bmg-secret-123" # Must match SYNC_API_KEY if configured

Write-Host "--- Booomerangs Category Sync ---" -ForegroundColor Cyan

# 1. Trigger Category Backfill
$BackfillUrl = "$BaseUrl/api/backfill-categories"
Write-Host "Sending request to backfill categories: $BackfillUrl"

try {
    # If the endpoint requires an API key, it should be sent in the headers
    $Headers = @{
        "x-api-key" = $ApiKey
    }
    
    $Response = Invoke-RestMethod -Uri $BackfillUrl -Method Post -ContentType "application/json" -Headers $Headers
    Write-Host "Success: $($Response.message)" -ForegroundColor Green
    if ($Response.count) {
        Write-Host "Updated $($Response.count) products." -ForegroundColor Green
    }
} catch {
    Write-Host "Failed to synchronize categories. Error: $_" -ForegroundColor Red
}

# 2. Optional: Trigger Sync from Storage
$SyncUrl = "$BaseUrl/api/sync-from-storage"
Write-Host "`nDo you want to sync products from Yandex Storage first? (Y/N)" -ForegroundColor Yellow
$choice = Read-Host
if ($choice -eq 'Y' -or $choice -eq 'y') {
    Write-Host "Triggering sync from storage..." -ForegroundColor Cyan
    try {
        $SyncResponse = Invoke-RestMethod -Uri $SyncUrl -Method Post -ContentType "application/json" -Headers $Headers
        Write-Host "Sync from storage completed." -ForegroundColor Green
    } catch {
        Write-Host "Failed to sync from storage. Error: $_" -ForegroundColor Red
    }
}

Write-Host "`n--- Process Finished ---" -ForegroundColor Cyan
Read-Host "Press Enter to exit"
