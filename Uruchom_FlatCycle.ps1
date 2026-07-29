$SDK_PATH = "C:\Users\adram\AppData\Local\Android\Sdk"
$ADB = "$SDK_PATH\platform-tools\adb.exe"
$EMULATOR = "$SDK_PATH\emulator\emulator.exe"
$APK_PATH = "A:\Leniwiec\app\build\outputs\apk\debug\app-debug.apk"

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  FlatCycle - Uruchamianie na Emulatorze  " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# Check if emulator is already running
$device_list = & $ADB devices
$is_running = $false
foreach ($line in $device_list) {
    if ($line -like "*emulator-5554*device*") {
        $is_running = $true
    }
}

if (-not $is_running) {
    Write-Host "[1/3] Uruchamianie emulatora (medium_phone)..."
    Start-Process -FilePath $EMULATOR -ArgumentList "@medium_phone", "-no-snapshot"
    
    Write-Host "[2/3] Oczekiwanie na uruchomienie systemu Android..."
    # Wait for basic ADB connection
    & $ADB wait-for-device
    
    # Wait for package manager and system to be fully loaded
    while ($true) {
        $boot = & $ADB shell getprop sys.boot_completed 2>$null
        if ($boot -and $boot.Trim() -eq "1") {
            break
        }
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 2
    }
    Write-Host ""
    Write-Host "System Android załadowany pomyślnie!"
} else {
    Write-Host "[1/3] Emulator jest już uruchomiony."
}

Write-Host "[3/3] Instalacja najnowszej wersji aplikacji..."
& $ADB install -r $APK_PATH

Write-Host ""
Write-Host "Wdrażanie aplikacji FlatCycle..."
& $ADB shell am force-stop com.example.flatcycle
& $ADB shell am start -n com.example.flatcycle/com.example.flatcycle.MainActivity

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Sukces! FlatCycle uruchomiony!          " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
