plugins {
    `java-library`
}

group = "org.btools"

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

// BRouter modules source sets — all 5 modules combined into one library
sourceSets {
    main {
        java {
            srcDir("src/main/java")
        }
    }
}
