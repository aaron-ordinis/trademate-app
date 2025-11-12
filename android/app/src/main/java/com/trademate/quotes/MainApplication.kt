package com.trademate.quotes

import android.app.Application
import android.content.res.Configuration
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.PackageList
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.soloader.SoLoader
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  companion object {
    private const val LOG_TAG = "MainApplication"
  }

  private val mReactNativeHost: ReactNativeHost =
    ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override fun getPackages(): MutableList<com.facebook.react.ReactPackage> {
          val packages = PackageList(this).packages
          // Manually add non-autolinked packages here if needed:
          // packages.add(MyReactNativePackage())
          return packages
        }

        // Use the standard entry point for release builds
        override fun getJSMainModuleName(): String = "index"

        override fun isNewArchEnabled(): Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override fun isHermesEnabled(): Boolean = BuildConfig.IS_HERMES_ENABLED
      }
    )

  override fun getReactNativeHost(): ReactNativeHost = mReactNativeHost

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, /* native exopackage */ false)

    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // Load native entry point only when New Architecture is enabled
      DefaultNewArchitectureEntryPoint.load()
    }

    // Guard ApplicationLifecycleDispatcher in case native expo modules (e.g. expo-constants)
    // are not installed; prevents app crash and prints a diagnostic log.
    try {
      ApplicationLifecycleDispatcher.onApplicationCreate(this)
    } catch (e: Exception) {
      Log.w(LOG_TAG, "ApplicationLifecycleDispatcher.onApplicationCreate failed", e)
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    try {
      ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
    } catch (e: Exception) {
      Log.w(LOG_TAG, "ApplicationLifecycleDispatcher.onConfigurationChanged failed", e)
    }
  }
}