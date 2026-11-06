import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.spotless)
}

kotlin {
    androidTarget { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.ui)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.coroutines.core)
        }
        androidMain.dependencies {
            implementation(libs.androidx.activity.compose)
            implementation(libs.androidx.core.ktx)
            implementation(libs.androidx.documentfile)
            implementation(libs.androidx.webkit)
        }
    }
}

android {
    namespace = "app.portdeck"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.portdeck"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "1.2.0"
    }
    sourceSets["main"].manifest.srcFile("src/androidMain/AndroidManifest.xml")
    sourceSets["main"].assets.srcDirs("src/androidMain/assets")
    sourceSets["main"].res.srcDirs("src/androidMain/res")
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

spotless {
    kotlin {
        target("src/**/*.kt")
        // Files intentionally group related declarations (e.g. generated icon data),
        // so the filename/classname rule does not apply here.
        ktlint("1.3.0").editorConfigOverride(mapOf("ktlint_standard_filename" to "disabled", "ktlint_function_naming_ignore_when_annotated_with" to "Composable"))
    }
    kotlinGradle {
        target("*.gradle.kts")
        ktlint("1.3.0")
    }
}
