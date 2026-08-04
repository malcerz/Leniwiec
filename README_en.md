# Leniwiec

Leniwiec is an Android app for planning and exporting simple route tracks in GPX format. The current codebase wraps a local HTML/JavaScript interface inside an Android `WebView`, requests device location permissions, and exposes a native share action for generated GPX files.

The app searches for roads with the least elevation gain, and generates loop routes by looking for the route with the fewest climbs

## What the app does

The application loads a bundled web interface from `app/src/main/assets/www/index.html` instead of rendering its main screen with native Compose views. Based on the Android code and packaged web assets, the main goal is to let the user work with route data in the embedded interface and then share the generated GPX file through Android's native share sheet.

## Current architecture

- Android app written in Kotlin.
- UI container created with Jetpack Compose.
- Main functionality displayed inside a `WebView`.
- Local web frontend built with HTML, CSS, and JavaScript.
- GPX export handled through a JavaScript-to-Android bridge.
- Secure file sharing implemented with `FileProvider`.

## Technical details

The project uses Android SDK 36, minimum SDK 24, Java 17, and Jetpack Compose with Material 3 dependencies. The manifest also enables internet access and coarse/fine location permissions, which matches a route-oriented or map-oriented mobile app.

## Project structure

```
app/
  src/main/
    java/com.example.leniwiec/   # Android host app
    assets/www/                   # Embedded web UI
    res/                          # Android resources
    AndroidManifest.xml
gradle/                           # Gradle wrapper and version catalog
build.gradle.kts                  # Root build configuration
settings.gradle.kts               # Project setup
Uruchom_Leniwiec.ps1             # Windows helper script
```

## Build and run

### Android Studio

1. Clone the repository:

```bash
git clone https://github.com/malcerz/Leniwiec.git
cd Leniwiec
```

2. Open the project in Android Studio.
3. Wait for Gradle sync to finish.
4. Run the `app` module on an emulator or Android device.

### Command line

Build a debug APK with:

```bash
./gradlew assembleDebug
```

On Windows:

```powershell
gradlew.bat assembleDebug
```

The generated APK should appear in:

```
app/build/outputs/apk/debug/
```

For convenience, the pre-compiled debug APK is also copied to the repository root as [app-debug.apk](file:///f:/_DEV/Leniwiec/app-debug.apk) and to the assets folder as [app/src/main/assets/app-debug.apk](file:///f:/_DEV/Leniwiec/app/src/main/assets/app-debug.apk).

## Permissions

The app currently declares the following permissions:

- `INTERNET`
- `ACCESS_FINE_LOCATION`
- `ACCESS_COARSE_LOCATION`

These permissions are consistent with an app that can work with location-aware route data and potentially web-based map components.

## Current status

This repository is at a very early stage: it has a single initial commit, no description, no tags, no releases, and no existing README in the repository root. The codebase also still contains temporary internal naming such as `Leniwiec` and `com.example.leniwiec`, so a future cleanup would help align branding with the Leniwiec project name.

## Next improvements

- Rename package and internal project identifiers from `Leniwiec` to `Leniwiec`.
- Add screenshots of the route editor/export UI.
- Document the exact GPX workflow: creating, editing, previewing, and exporting routes.

If you like this app, buy me a coffee.
https://buycoffee.to/malcerz
- Add release instructions for generating signed APK builds.
- Expand the README once the map logic and feature set stabilize.
