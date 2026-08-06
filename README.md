# Leniwiec

Leniwiec to aplikacja na Androida do planowania i eksportowania prostych tras w formacie GPX. Obecny kod aplikacji osadza lokalny interfejs HTML/JavaScript wewnątrz komponentu `WebView`, wymaga uprawnień lokalizacyjnych urządzenia oraz udostępnia natywną akcję udostępniania wygenerowanego pliku GPX.
Aplikacja wyszukuje dróg o najmniejszej liczbie przewyższeń, oraz generuje trasy w pętle szukając trasy o najmniejszej liczbie podjazdów

## Co robi aplikacja

Aplikacja wczytuje wbudowany interfejs webowy z pliku `app/src/main/assets/www/index.html` zamiast renderować główny ekran za pomocą natywnych widoków Compose. Na podstawie kodu Androida oraz dołączonych zasobów webowych można wywnioskować, że głównym celem jest umożliwienie użytkownikowi pracy z danymi trasy w osadzonym interfejsie, a następnie udostępnienie wygenerowanego pliku GPX przez natywne okno udostępniania Androida.

## Jak wytyczane są trasy

Trasy są wyznaczane **lokalnie na urządzeniu** za pomocą wbudowanego silnika BRouter (`brouter-lib`) i pobranych danych segmentów (`.rd5`). Gdy dane lokalne nie są dostępne, następuje awaryjne przełączenie na publiczne API `brouter.de`.

### Tryb A→B

- Dla punktów A i B aplikacja żąda od BRoutera `N` wariantów (alternatyw) jednocześnie (`alternativeidx` 0..N).
- Wariant, który nie spełnia kryteriów, jest odrzucany, a aplikacja pobiera kolejne alternatywy (do 10), aż uzyska zadaną liczbę tras.

### Tryb pętli (loop)

- Użytkownik podaje długość pętli (km). BRouter w trybie round-trip rozkłada miękkie punkty trasy na okręgu wokół punktu startowego i dopasowuje je do płaskiej infrastruktury w pobliżu.
- Promień okręgu to ~1/5 zadanej długości (długość pętli ≈ 5× promień), min. 500 m.
- Kolejne warianty powstają przez obracanie kąta startowego (krok 360°/N, z przesunięciem 15° między rundami, do 36 kątów).
- Czas obliczeń jest skalowany do długości trasy: ~30 s na każde 10 km (min. 20 s) na wariant, a cała seria ma twardy limit 6 minut — interfejs zawsze kończy pracę.

### Kryteria i punktacja (Faza 2)

Każdy wygenerowany kandydat jest oceniany i może zostać odrzucony, jeśli nie spełnia kryteriów:

- przewyższenie ≤ 15 m na km trasy,
- nakładanie się trasy na siebie ≤ 10 % długości,
- dla pętli: długość w zakresie ±40 % od zadanej.

Progi te można dostosować w aplikacji: ikona suwaków w nagłówku → „Ustawienia tras”. Zmiany są zapisywane na urządzeniu i używane przy kolejnych obliczeniach.

Odrzucone trasy nie wliczają się do wyniku — poszukiwanie jest powtarzane, aż zostanie zebrana zadana liczba wariantów. Jeśli w bardzo pagórkowatym terenie żadna trasa nie spełni kryteriów, pokazywane są najlepsze z odrzuconych.

Pozostałe kandydatury są sortowane według punktacji:

```
Score = 1·|długość − długość zadana| + 2·suma podjazdów + 1·nakładanie [m]
```

Trasa o najmniejszym przewyższeniu („Najbardziej płaska”) jest zawsze umieszczana jako pierwsza na liście.

## Obecna architektura

- Aplikacja na Androida napisana w Kotlinie.
- Kontener UI zbudowany w Jetpack Compose.
- Główna funkcjonalność wyświetlana wewnątrz `WebView`.
- Lokalny frontend webowy zbudowany w HTML, CSS i JavaScript.
- Lokalne wyznaczanie tras offline przez wbudowany silnik BRouter (`brouter-lib`).
- Eksport GPX obsługiwany przez most JavaScript–Android.
- Bezpieczne udostępnianie plików zaimplementowane za pomocą `FileProvider`.

## Szczegóły techniczne

Projekt korzysta z Android SDK 36, minimalnego SDK 24, Javy 17 oraz Jetpack Compose z zależnościami Material 3. Manifest aplikacji włącza również dostęp do internetu oraz uprawnienia lokalizacji (dokładnej i przybliżonej), co jest spójne z aplikacją zorientowaną na trasy lub mapy.

Każdy build automatycznie zwiększa licznik wersji w `app/version.properties` (wersja `1.00XX`), wyświetlany w aplikacji obok nazwy „Leniwiec”.

## Struktura projektu

```
app/
  src/main/
    java/com.example.leniwiec/   # Kod aplikacji Android
    assets/www/                   # Osadzony interfejs webowy
    res/                          # Zasoby Androida
    AndroidManifest.xml
brouter-lib/                     # Lokalny silnik routingu BRouter
gradle/                           # Gradle wrapper i katalog wersji
build.gradle.kts                  # Główna konfiguracja builda
settings.gradle.kts               # Konfiguracja projektu
Uruchom_Leniwiec.ps1             # Skrypt pomocniczy dla Windows
```

## Budowanie i uruchamianie

### Android Studio

1. Sklonuj repozytorium:

```bash
git clone https://github.com/malcerz/Leniwiec.git
cd Leniwiec
```

2. Otwórz projekt w Android Studio.
3. Poczekaj na zakończenie synchronizacji Gradle.
4. Uruchom moduł `app` na emulatorze lub urządzeniu z Androidem.

### Wiersz poleceń

Zbuduj wersję debug APK poleceniem:

```bash
./gradlew assembleDebug
```

Na Windows:

```powershell
gradlew.bat assembleDebug
```

Wygenerowany plik APK powinien pojawić się w:

```
app/build/outputs/apk/debug/
```

Dla ułatwienia, skompilowany plik APK jest również kopiowany do głównego katalogu repozytorium jako [app-debug.apk](file:///f:/_DEV/Leniwiec/app-debug.apk) oraz do folderu assets jako [app/src/main/assets/app-debug.apk](file:///f:/_DEV/Leniwiec/app/src/main/assets/app-debug.apk).

Wersję release można zbudować poleceniem `gradlew.bat assembleRelease`; powstały plik `app/build/outputs/apk/release/app-release.apk` jest również kopiowany do głównego katalogu repozytorium jako `app-release.apk`.

## Uprawnienia

Aplikacja aktualnie deklaruje następujące uprawnienia:

- `INTERNET`
- `ACCESS_FINE_LOCATION`
- `ACCESS_COARSE_LOCATION`

Te uprawnienia są spójne z aplikacją, która może operować na danych trasy zależnych od lokalizacji oraz potencjalnie korzystać z komponentów mapowych opartych o web.

## Obecny status

Aplikacja jest w aktywnej fazie rozwoju i działa w pełni lokalnie (offline) dzięki wbudowanemu silnikowi BRouter (`brouter-lib`) — trasy są wyznaczane na urządzeniu, bez zewnętrznych serwerów (z wyjątkiem geokodowania oraz awaryjnego pobierania tras online). Projekt jest rozwijany na GitHubie. Kod nadal używa tymczasowego identyfikatora pakietu `com.example.leniwiec`.

## Dalsze usprawnienia

- Dodanie zrzutów ekranu edytora/eksportu tras.
- Dodanie instrukcji wydania dla generowania podpisanych buildów APK.

Jeżeli podoba ci się ta aplikacja to kup mi kawę
- https://buycoffee.to/malcerz
