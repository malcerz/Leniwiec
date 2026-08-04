$SDK_PATH = "C:\Users\uck_p\AppData\Local\Android\Sdk"
$ADB = "$SDK_PATH\platform-tools\adb.exe"
$EMULATOR = "$SDK_PATH\emulator\emulator.exe"
$APK_PATH = "f:\_DEV\Leniwiec\app\build\outputs\apk\release\app-release.apk"

Write-Host "==========================================" -ForegroundColor Green
Write-Host "    Leniwiec - Uruchamianie na Urządzeniu " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# Get list of connected devices
$device_list = & $ADB devices
$devices = @()
foreach ($line in $device_list) {
    if ($line -match "^([^\s]+)\s+device$") {
        $devices += $Matches[1]
    }
}

if ($devices.Count -eq 0) {
    Write-Host "Brak podłączonych urządzeń. Próba uruchomienia emulatora..."
    Start-Process -FilePath $EMULATOR -ArgumentList "@phone", "-no-snapshot"
    
    Write-Host "Oczekiwanie na uruchomienie systemu Android..."
    & $ADB wait-for-device
    
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
    $target_device = "emulator-5554"
} elseif ($devices.Count -eq 1) {
    $target_device = $devices[0]
    Write-Host "Wykryto jedno urządzenie: $target_device"
} else {
    Write-Host "Wykryto wiele urządzeń:"
    for ($i = 0; $i -lt $devices.Count; $i++) {
        Write-Host "[$i] $($devices[$i])"
    }
    $choice = Read-Host "Wybierz numer urządzenia (domyślnie 0)"
    if ($choice -match "^\d+$" -and [int]$choice -lt $devices.Count) {
        $target_device = $devices[[int]$choice]
    } else {
        $target_device = $devices[0]
    }
    Write-Host "Wybrano: $target_device"
}

Write-Host "Instalacja najnowszej wersji aplikacji na $target_device..."
& .\gradlew assembleRelease --no-configuration-cache
& $ADB -s $target_device install -r $APK_PATH

Write-Host ""
Write-Host "Wdrażanie aplikacji Leniwiec..."
& $ADB -s $target_device shell am force-stop com.example.leniwiec
& $ADB -s $target_device shell am start -n com.example.leniwiec/com.example.leniwiec.MainActivity

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Sukces! Leniwiec uruchomiony!           " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
