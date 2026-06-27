import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.readest.webview_upgrade"
    compileSdk = 36

    defaultConfig {
        minSdk = 21

        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }

    sourceSets["main"].kotlin.srcDir(
        layout.buildDirectory.dir("generated/source/webview-upgrade")
    )
}

dependencies {
    // Hooks the in-process WebView loader via runtime annotations on hidden
    // AOSP interfaces. The R8 keep rules to survive minification ship in
    // this module's consumer-rules.pro.
    implementation("io.github.jonanorman.android.webviewup:core:0.1.0")
    // App Startup runs registered Initializers from a single ContentProvider
    // during process attach, before Application.onCreate. That's the only
    // window in which WebViewUpgrade is allowed to swap the WebView provider.
    implementation("androidx.startup:startup-runtime:1.2.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation(project(":tauri-android"))
}

// --- Config injection from host's tauri.conf.json -----------------------------
//
// The Tauri CLI exports each plugin's `plugins.<name>` block from
// tauri.conf.json as the env var TAURI_<NAME>_PLUGIN_CONFIG (uppercase, hyphens
// → underscores). Gradle inherits env vars from the CLI subprocess, so we read
// it directly here and bake the values into a generated Kotlin object that the
// Initializer reads at runtime.
//
// Fall-back chain when the env var is absent (e.g. Gradle invoked directly,
// not via `tauri android …`): walk up from projectDir looking for the host's
// tauri.conf.json and read the same block from disk. If neither is found,
// use the defaults below — matching what the upstream code shipped before
// the config was extracted.

val defaultMinUpgradeMajor = 121
val defaultMinSupportedMajor = 92

@Suppress("UNCHECKED_CAST")
fun readPluginConfigFromJson(jsonText: String?): Pair<Int, Int> {
    if (jsonText.isNullOrBlank()) return defaultMinUpgradeMajor to defaultMinSupportedMajor
    val parsed = JsonSlurper().parseText(jsonText) as? Map<String, Any?>
        ?: return defaultMinUpgradeMajor to defaultMinSupportedMajor
    val upgrade = (parsed["minUpgradeMajor"] as? Number)?.toInt() ?: defaultMinUpgradeMajor
    val supported = (parsed["minSupportedMajor"] as? Number)?.toInt() ?: defaultMinSupportedMajor
    return upgrade to supported
}

@Suppress("UNCHECKED_CAST")
fun readPluginConfigFromTauriConf(file: File): Pair<Int, Int> {
    val root = JsonSlurper().parse(file) as? Map<String, Any?>
        ?: return defaultMinUpgradeMajor to defaultMinSupportedMajor
    val plugins = root["plugins"] as? Map<String, Any?>
        ?: return defaultMinUpgradeMajor to defaultMinSupportedMajor
    val cfg = plugins["webview-upgrade"] as? Map<String, Any?>
        ?: return defaultMinUpgradeMajor to defaultMinSupportedMajor
    val upgrade = (cfg["minUpgradeMajor"] as? Number)?.toInt() ?: defaultMinUpgradeMajor
    val supported = (cfg["minSupportedMajor"] as? Number)?.toInt() ?: defaultMinSupportedMajor
    return upgrade to supported
}

fun findTauriConf(start: File): File? {
    var current: File? = start
    while (current != null) {
        val candidate = File(current, "tauri.conf.json")
        if (candidate.exists()) return candidate
        current = current.parentFile
    }
    return null
}

val generatedConfigDir = layout.buildDirectory.dir("generated/source/webview-upgrade")

val generateWebViewUpgradeConfig = tasks.register("generateWebViewUpgradeConfig") {
    val envJson = System.getenv("TAURI_WEBVIEW_UPGRADE_PLUGIN_CONFIG")
    val tauriConfFile = findTauriConf(projectDir)
    if (envJson == null && tauriConfFile != null) {
        inputs.file(tauriConfFile)
    }
    inputs.property("envJson", envJson ?: "")
    outputs.dir(generatedConfigDir)

    doLast {
        val (minUpgrade, minSupported) = when {
            !envJson.isNullOrBlank() -> readPluginConfigFromJson(envJson)
            tauriConfFile != null -> readPluginConfigFromTauriConf(tauriConfFile)
            else -> defaultMinUpgradeMajor to defaultMinSupportedMajor
        }
        val source = when {
            !envJson.isNullOrBlank() -> "TAURI_WEBVIEW_UPGRADE_PLUGIN_CONFIG env var"
            tauriConfFile != null -> "tauri.conf.json at $tauriConfFile"
            else -> "defaults (no config found)"
        }
        val outDir = generatedConfigDir.get().asFile
        val pkgDir = File(outDir, "com/readest/webview_upgrade")
        pkgDir.mkdirs()
        File(pkgDir, "WebViewUpgradeConfig.kt").writeText(
            """
            // Generated by build.gradle.kts at build time. Do not edit by hand.
            // Source: $source
            package com.readest.webview_upgrade

            internal object WebViewUpgradeConfig {
                const val MIN_UPGRADE_MAJOR: Int = $minUpgrade
                const val MIN_SUPPORTED_MAJOR: Int = $minSupported
            }
            """.trimIndent() + "\n"
        )
        logger.lifecycle(
            "WebViewUpgradeConfig: minUpgradeMajor=$minUpgrade, minSupportedMajor=$minSupported " +
                "(from $source)"
        )
    }
}

tasks.withType<KotlinCompile>().configureEach {
    dependsOn(generateWebViewUpgradeConfig)
}
