# Booomerangs Category Sync Script
# Usage: Run this script in PowerShell to sync categories on Yandex Cloud

$headers = @{
    "x-api-key" = "BOOOmerangs"
}

Write-Host "Syncing categories on Yandex Cloud..." -ForegroundColor Cyan

try {
    # Step 1: Optional - Sync from storage if needed
    # Write-Host "Checking for new files in storage..."
    # Invoke-RestMethod -Method POST -Uri "https://bba6fol2jvub7mr2uahi.containers.yandexcloud.net/api/sync-from-storage" -Headers $headers

    # Step 2: Backfill categories
    $categories = Invoke-RestMethod -Method POST -Uri "https://bba6fol2jvub7mr2uahi.containers.yandexcloud.net/api/backfill-categories" -Headers $headers

    # Output the result
    $categories | ConvertTo-Json -Depth 5
} catch {
    Write-Error "Sync failed: $_"
}
