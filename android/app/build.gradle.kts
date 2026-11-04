plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.potatochat.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.potatochat.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "1.3.0"
        // Endereço do site. Para testar com o PHP local: ./gradlew assembleDebug -PpotatoSite=http://localhost:8000/
        // (no emulador, antes: adb reverse tcp:8000 tcp:8000).
        buildConfigField("String", "SITE_URL", "\"${project.findProperty("potatoSite") ?: "https://potato.andrejrs.com.br/"}\"")
        // APK enxuto para aparelhos Android atuais; evita empacotar quatro cópias do WebRTC nativo.
        ndk { abiFilters += (project.findProperty("potatoAbis")?.toString() ?: "arm64-v8a").split(",") }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.github.webrtc-sdk:android:150.7871.01")
}
