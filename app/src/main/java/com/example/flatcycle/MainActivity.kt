package com.example.flatcycle

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.example.flatcycle.theme.FlatCycleTheme
import java.io.File
import java.io.FileWriter

class MainActivity : ComponentActivity() {
  private val LOCATION_PERMISSION_REQUEST_CODE = 1001

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    // Request location permissions if not already granted
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(
        this,
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
        LOCATION_PERMISSION_REQUEST_CODE
      )
    }

    setContent {
      FlatCycleTheme {
        AndroidView(
          factory = { context ->
            WebView(context).apply {
              layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
              )
              webViewClient = WebViewClient()
              webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(
                  origin: String?,
                  callback: GeolocationPermissions.Callback?
                ) {
                  // Always grant location permission to the WebView pages
                  callback?.invoke(origin, true, false)
                }
              }
              settings.javaScriptEnabled = true
              settings.domStorageEnabled = true
              settings.setGeolocationEnabled(true)
              settings.databaseEnabled = true
              settings.allowUniversalAccessFromFileURLs = true
              settings.allowFileAccessFromFileURLs = true
              
              // Register GPX sharing interface
              addJavascriptInterface(WebAppInterface(this@MainActivity), "AndroidInterface")

              // Load the main HTML page
              loadUrl("file:///android_asset/www/index.html")
            }
          },
          modifier = Modifier.fillMaxSize()
        )
      }
    }
  }
}

class WebAppInterface(private val activity: MainActivity) {
  @JavascriptInterface
  fun shareGPX(fileName: String, gpxContent: String) {
    activity.runOnUiThread {
      try {
        val cacheDir = File(activity.cacheDir, "gpx")
        if (!cacheDir.exists()) {
          cacheDir.mkdirs()
        }
        val file = File(cacheDir, fileName)
        val writer = FileWriter(file)
        writer.write(gpxContent)
        writer.close()

        val uri = FileProvider.getUriForFile(
          activity,
          "${activity.packageName}.fileprovider",
          file
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
          type = "application/gpx+xml"
          putExtra(Intent.EXTRA_STREAM, uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(intent, "Udostępnij trasę GPX"))
      } catch (e: Exception) {
        Toast.makeText(activity, "Błąd podczas udostępniania GPX: ${e.message}", Toast.LENGTH_LONG).show()
      }
    }
  }
}
