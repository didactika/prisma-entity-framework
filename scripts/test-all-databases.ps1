#!/usr/bin/env pwsh
# Test script to run tests on all supported databases
# Prerequisites: Docker must be running

# Global error handling
$ErrorActionPreference = "Continue"

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('Info', 'Success', 'Warning', 'Error')]
        [string]$Level = 'Info'
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        'Info'    { 'Cyan' }
        'Success' { 'Green' }
        'Warning' { 'Yellow' }
        'Error'   { 'Red' }
    }
    
    $prefix = switch ($Level) {
        'Info'    { '[INFO]' }
        'Success' { '[SUCCESS]' }
        'Warning' { '[WARNING]' }
        'Error'   { '[ERROR]' }
    }
    
    Write-Host "$timestamp $prefix $Message" -ForegroundColor $color
}

function Format-Duration {
    param([double]$Seconds)
    
    if ($Seconds -lt 60) {
        return "$([math]::Round($Seconds, 2))s"
    } elseif ($Seconds -lt 3600) {
        $minutes = [math]::Floor($Seconds / 60)
        $secs = [math]::Round($Seconds % 60, 0)
        return "${minutes}m ${secs}s"
    } else {
        $hours = [math]::Floor($Seconds / 3600)
        $minutes = [math]::Floor(($Seconds % 3600) / 60)
        return "${hours}h ${minutes}m"
    }
}

function Test-DockerRunning {
    try {
        docker info 2>&1 | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

# Main execution
try {
    $overallStartTime = Get-Date
    
    Write-Host ""
    Write-Log "===============================================" -Level Info
    Write-Log "COMPREHENSIVE DATABASE TESTING" -Level Info
    Write-Log "===============================================" -Level Info
    Write-Host ""
    
    # Check Docker availability
    Write-Log "Checking Docker availability..." -Level Info
    if (-not (Test-DockerRunning)) {
        Write-Log "Docker is not running or not available" -Level Error
        Write-Log "Please start Docker and try again" -Level Error
        exit 1
    }
    Write-Log "Docker is running" -Level Success
    Write-Host ""

    # Initialize results tracking
    $results = @()
    $databases = @('sqlite', 'mysql', 'postgresql', 'mongodb')
    $totalTests = $databases.Count
    $passedTests = 0
    $failedTests = 0
    $skippedTests = 0

    # Test each database
    foreach ($db in $databases) {
        Write-Host ""
        Write-Log "===============================================" -Level Info
        Write-Log "Testing Database: $($db.ToUpper())" -Level Info
        Write-Log "===============================================" -Level Info
        Write-Host ""
        
        $dbStartTime = Get-Date
        $testPassed = $false
        $errorMessage = $null
        
        try {
            & "$PSScriptRoot\test-database.ps1" -Database $db
            
            if ($LASTEXITCODE -eq 0) {
                $testPassed = $true
                $passedTests++
                Write-Log "$db tests PASSED" -Level Success
            } else {
                $failedTests++
                $errorMessage = "Tests failed with exit code $LASTEXITCODE"
                Write-Log "$db tests FAILED (exit code: $LASTEXITCODE)" -Level Error
            }
        } catch {
            $failedTests++
            $errorMessage = $_.Exception.Message
            Write-Log "$db tests FAILED with exception: $_" -Level Error
        }
        
        $dbEndTime = Get-Date
        $dbDuration = ($dbEndTime - $dbStartTime).TotalSeconds
        
        # Store result
        $results += [PSCustomObject]@{
            Database = $db
            Status = if ($testPassed) { "PASSED" } else { "FAILED" }
            Duration = $dbDuration
            ErrorMessage = $errorMessage
        }
        
        Write-Log "Duration: $(Format-Duration $dbDuration)" -Level Info
        Write-Host ""
    }

    $overallEndTime = Get-Date
    $overallDuration = ($overallEndTime - $overallStartTime).TotalSeconds

    # Generate comprehensive summary
    Write-Host ""
    Write-Host ""
    Write-Log "===============================================" -Level Info
    Write-Log "COMPREHENSIVE TEST SUMMARY" -Level Info
    Write-Log "===============================================" -Level Info
    Write-Host ""
    
    # Individual database results
    Write-Log "Individual Database Results:" -Level Info
    Write-Host ""
    
    $maxDbNameLength = ($results | ForEach-Object { $_.Database.Length } | Measure-Object -Maximum).Maximum
    $maxStatusLength = 6  # Length of "FAILED"
    $maxDurationLength = 10
    
    # Header
    $headerFormat = "  {0,-$maxDbNameLength}  {1,-$maxStatusLength}  {2,-$maxDurationLength}"
    Write-Host ($headerFormat -f "Database", "Status", "Duration") -ForegroundColor White
    Write-Host ($headerFormat -f ("-" * $maxDbNameLength), ("-" * $maxStatusLength), ("-" * $maxDurationLength)) -ForegroundColor Gray
    
    # Results
    foreach ($result in $results) {
        $statusColor = if ($result.Status -eq "PASSED") { "Green" } else { "Red" }
        $durationStr = Format-Duration $result.Duration
        
        Write-Host "  " -NoNewline
        Write-Host ("{0,-$maxDbNameLength}" -f $result.Database) -NoNewline -ForegroundColor Cyan
        Write-Host "  " -NoNewline
        Write-Host ("{0,-$maxStatusLength}" -f $result.Status) -NoNewline -ForegroundColor $statusColor
        Write-Host "  " -NoNewline
        Write-Host ("{0,-$maxDurationLength}" -f $durationStr) -ForegroundColor White
        
        if ($result.ErrorMessage) {
            Write-Host "    Error: $($result.ErrorMessage)" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host ""
    
    # Overall statistics
    Write-Log "Overall Statistics:" -Level Info
    Write-Host ""
    Write-Host "  Total Databases Tested: $totalTests" -ForegroundColor White
    Write-Host "  Passed: $passedTests" -ForegroundColor Green
    Write-Host "  Failed: $failedTests" -ForegroundColor $(if ($failedTests -gt 0) { "Red" } else { "White" })
    Write-Host "  Skipped: $skippedTests" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Total Duration: $(Format-Duration $overallDuration)" -ForegroundColor White
    Write-Host "  Average Duration: $(Format-Duration ($overallDuration / $totalTests))" -ForegroundColor White
    Write-Host ""
    
    # Success rate
    $successRate = [math]::Round(($passedTests / $totalTests) * 100, 1)
    Write-Host "  Success Rate: $successRate%" -ForegroundColor $(if ($successRate -eq 100) { "Green" } elseif ($successRate -ge 75) { "Yellow" } else { "Red" })
    Write-Host ""
    
    Write-Log "===============================================" -Level Info
    
    # Final result
    Write-Host ""
    if ($failedTests -eq 0) {
        Write-Log "ALL DATABASE TESTS PASSED!" -Level Success
        Write-Host ""
        exit 0
    } else {
        Write-Log "SOME DATABASE TESTS FAILED" -Level Error
        $failedDbs = ($results | Where-Object { $_.Status -eq 'FAILED' } | ForEach-Object { $_.Database }) -join ', '
        Write-Log "Failed databases: $failedDbs" -Level Error
        Write-Host ""
        exit 1
    }

} catch {
    Write-Host ""
    Write-Log "===============================================" -Level Error
    Write-Log "FATAL ERROR IN TEST RUNNER" -Level Error
    Write-Log "===============================================" -Level Error
    Write-Log "An unexpected error occurred:" -Level Error
    Write-Log "$_" -Level Error
    Write-Host ""
    exit 1
}
