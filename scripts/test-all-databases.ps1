#!/usr/bin/env pwsh
# Test script to run tests on all supported databases
# Prerequisites: Docker must be running

Write-Host "Starting comprehensive database testing..." -ForegroundColor Cyan
Write-Host ""

$failed = $false

# Test each database
$databases = @('sqlite', 'mysql', 'postgresql', 'mongodb')

foreach ($db in $databases) {
    Write-Host "===============================================" -ForegroundColor Blue
    Write-Host "Testing with $db" -ForegroundColor Blue
    Write-Host "===============================================" -ForegroundColor Blue
    
    & "$PSScriptRoot\test-database.ps1" -Database $db
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] $db tests failed" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "[SUCCESS] $db tests passed" -ForegroundColor Green
    }
    Write-Host ""
}

# Summary
Write-Host "===============================================" -ForegroundColor Blue
Write-Host "Test Summary" -ForegroundColor Blue
Write-Host "===============================================" -ForegroundColor Blue

if ($failed) {
    Write-Host "[ERROR] Some tests failed" -ForegroundColor Red
    exit 1
} else {
    Write-Host "[SUCCESS] All database tests passed!" -ForegroundColor Green
    exit 0
}
