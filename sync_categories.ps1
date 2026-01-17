# PowerShell Script for Booomerangs (BMGBRAND) Category Synchronization
# Designed for execution on a local PC to sync categories on Yandex Cloud.

# --- CONFIGURATION ---
# Replace with your actual Yandex Cloud URL (e.g., https://functions.yandexcloud.net/...)
$BaseUrl = "https://booomerangs-bmgbrand.replit.app" 
# Security key (must match SYNC_API_KEY on the server)
$ApiKey = "bmg-secret-123" 

# --- SCRIPT START ---
$ErrorActionPreference = "Stop"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   BMGBRAND Category Synchronization" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Target: $BaseUrl" -ForegroundColor Gray

function Send-SyncRequest {
    param($Endpoint, $Name)
    
    $Url = "$BaseUrl$Endpoint"
    Write-Host "`n[i] Starting $Name..." -ForegroundColor Cyan
    Write-Host "URL: $Url" -ForegroundColor Gray
    
    try {
        $Headers = @{
            "x-api-key" = $ApiKey
            "Content-Type" = "application/json"
        }
        
        $Timer = [System.Diagnostics.Stopwatch]::StartNew()
        $Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -TimeoutSec 120
        $Timer.Stop()
        
        Write-Host "SUCCESS!" -ForegroundColor Green
        Write-Host "Server Response: $($Response.message)" -ForegroundColor White
        if ($Response.count) {
            Write-Host "Items affected: $($Response.count)" -ForegroundColor Green
        }
        Write-Host "Time taken: $($Timer.Elapsed.TotalSeconds.ToString('F2')) seconds" -ForegroundColor Gray
    } catch {
        Write-Host "ERROR!" -ForegroundColor Red
        if ($_.Exception.Response) {
            $Stream = $_.Exception.Response.GetResponseStream()
            $Reader = New-Object System.IO.StreamReader($Stream)
            $ErrDetail = $Reader.ReadToEnd()
            Write-Host "Details: $ErrDetail" -ForegroundColor Yellow
        } else {
            Write-Host "Details: $_" -ForegroundColor Yellow
        }
    }
}

# 1. Ask for full sync from storage
$Choice = Read-Host "Sync products from Yandex Object Storage first? (Y/N)"
if ($Choice -eq 'Y' -or $Choice -eq 'y') {
    Send-SyncRequest -Endpoint "/api/sync-from-storage" -Name "Cloud Storage Sync"
}

# 2. Always run category backfill/mapping
Send-SyncRequest -Endpoint "/api/backfill-categories" -Name "Category Mapping & Backfill"

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "   Synchronization Process Finished" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Read-Host "Press Enter to exit"
