# Leniwiec

Leniwiec to aplikacja na Androida do planowania i eksportowania prostych tras w formacie GPX. Obecny kod aplikacji osadza lokalny interfejs HTML/JavaScript wewnątrz komponentu `WebView`, wymaga uprawnień lokalizacyjnych urządzenia oraz udostępnia natywną akcję udostępniania wygenerowanego pliku GPX.
Aplikacja wyszukuje dróg o najmniejszej liczbie przewyższeń, oraz generuje trasy w pętle szukając trasy o najmniejszej liczbie podjazdów

## Co robi aplikacja

Aplikacja wczytuje wbudowany interfejs webowy z pliku `app/src/main/assets/www/index.html` zamiast renderować główny ekran za pomocą natywnych widoków Compose. Na podstawie kodu Androida oraz dołączonych zasobów webowych można wywnioskować, że głównym celem jest umożliwienie użytkownikowi pracy z danymi trasy w osadzonym interfejsie, a następnie udostępnienie wygenerowanego pliku GPX przez natywne okno udostępniania Androida.

## Obecna architektura

- Aplikacja na Androida napisana w Kotlinie.
- Kontener UI zbudowany w Jetpack Compose.
- Główna funkcjonalność wyświetlana wewnątrz `WebView`.
- Lokalny frontend webowy zbudowany w HTML, CSS i JavaScript.
- Eksport GPX obsługiwany przez most JavaScript–Android.
- Bezpieczne udostępnianie plików zaimplementowane za pomocą `FileProvider`.

## Szczegóły techniczne

Projekt korzysta z Android SDK 36, minimalnego SDK 24, Javy 17 oraz Jetpack Compose z zależnościami Material 3. Manifest aplikacji włącza również dostęp do internetu oraz uprawnienia lokalizacji (dokładnej i przybliżonej), co jest spójne z aplikacją zorientowaną na trasy lub mapy.

## Struktura projektu

```
app/
  src/main/
    java/com/example/flatcycle/   # Kod aplikacji Android
    assets/www/                   # Osadzony interfejs webowy
    res/                          # Zasoby Androida
    AndroidManifest.xml
gradle/                           # Gradle wrapper i katalog wersji
build.gradle.kts                  # Główna konfiguracja builda
settings.gradle.kts               # Konfiguracja projektu
Uruchom_FlatCycle.ps1             # Skrypt pomocniczy dla Windows
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

## Uprawnienia

Aplikacja aktualnie deklaruje następujące uprawnienia:

- `INTERNET`
- `ACCESS_FINE_LOCATION`
- `ACCESS_COARSE_LOCATION`

Te uprawnienia są spójne z aplikacją, która może operować na danych trasy zależnych od lokalizacji oraz potencjalnie korzystać z komponentów mapowych opartych o web.

## Obecny status

Repozytorium jest na bardzo wczesnym etapie: zawiera pojedynczy commit początkowy, brak opisu, brak tagów, brak wydań (releases) oraz brak istniejącego pliku README w katalogu głównym przed tą zmianą. Kod zawiera też tymczasowe wewnętrzne nazewnictwo, takie jak `FlatCycle` i `com.example.flatcycle`, więc w przyszłości warto ujednolicić nazewnictwo z nazwą projektu Leniwiec.

## Dalsze usprawnienia

- Zmiana nazwy pakietu i wewnętrznych identyfikatorów projektu z `FlatCycle` na `Leniwiec`.
- Dodanie zrzutów ekranu edytora/eksportu tras.
- Udokumentowanie dokładnego przepływu pracy z GPX: tworzenie, edycja, podgląd i eksport tras.
- Dodanie instrukcji wydania dla generowania podpisanych buildów APK.
- Rozbudowa README wraz ze stabilizacją logiki map i zestawu funkcji.

Jeżeli podoba ci się ta aplikacja to kup mi kawę
- https://buycoffee.to/malcerz
