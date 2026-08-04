import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.example.leniwiec"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.leniwiec"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug") 
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        aidl = false
        buildConfig = true
        shaders = false
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    // Poprawiony blok lint dla Kotlin DSL (.kts)
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
} // <--- Tutaj brakowało domknięcia bloku android

kotlin {
    jvmToolchain(17)
}

dependencies {
    val composeBom = platform(libs.androidx.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    // Core Android dependencies
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    // Arch Components
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    // Compose
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    // Tooling
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Instrumented tests
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    // Local tests: jUnit, coroutines, Android runner
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    // Instrumented tests: jUnit rules and runners
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.espresso.core)

    // BRouter — local routing engine
    implementation(project(":brouter-lib"))

    // Navigation
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
}

// ── Auto-incrementing build version (shown in the app UI next to "Leniwiec") ──
// Every build bumps app/version.properties by 1 and writes the version string
// into a generated asset (www/app-version.txt) that the WebView reads at runtime.
// Starts at "1.0001" (buildNumber 0 -> 1 on the first build).
abstract class BumpVersionTask : DefaultTask() {

  @get:OutputDirectory
  abstract val outDir: DirectoryProperty

  @get:Internal
  abstract val versionFile: RegularFileProperty

  @TaskAction
  fun run() {
    val propsFile = versionFile.get().asFile
    val props = Properties()
    if (propsFile.exists()) {
      propsFile.inputStream().use { props.load(it) }
    }
    val buildNumber = (props.getProperty("buildNumber")?.toIntOrNull() ?: 0) + 1
    props.setProperty("buildNumber", buildNumber.toString())
    propsFile.outputStream().use { props.store(it, "Auto-incremented build counter. Bumped on every build.") }

    val version = "1." + String.format("%04d", buildNumber)
    val target = outDir.get().dir("www").file("app-version.txt").asFile
    target.parentFile.mkdirs()
    target.writeText(version)
    logger.lifecycle("Leniwiec build version: $version")
  }
}

val bumpVersion = tasks.register<BumpVersionTask>("bumpVersion") {
  versionFile.set(layout.projectDirectory.file("version.properties"))
  // Always run so the counter increments on every build (never up-to-date)
  outputs.upToDateWhen { false }
}

// Expose the generated version file as an Android asset (www/app-version.txt)
androidComponents {
  onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(bumpVersion) { it.outDir }
  }
}