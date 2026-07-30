package com.example.flatcycle

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
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
import androidx.lifecycle.lifecycleScope
import com.example.flatcycle.routing.LocalRouteService
import com.example.flatcycle.routing.RouteDataManager
import com.example.flatcycle.theme.FlatCycleTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileWriter

class MainActivity : ComponentActivity() {
  private val LOCATION_PERMISSION_REQUEST_CODE = 1001
  private lateinit var routeService: LocalRouteService
  private lateinit var dataManager: RouteDataManager

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    // Initialize routing services
    routeService = LocalRouteService(applicationContext)
    dataManager = RouteDataManager(applicationContext)

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

              // Register unified interface (routing + GPX sharing)
              addJavascriptInterface(WebAppInterface(this@MainActivity, this, routeService, dataManager), "AndroidInterface")

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

class WebAppInterface(
  private val activity: MainActivity,
  private val webView: WebView,
  private val routeService: LocalRouteService,
  private val dataManager: RouteDataManager
) {
  companion object {
    private const val TAG = "WebAppInterface"
  }

  // ── GPX Sharing (existing) ──

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

  // ── Local Route Calculation (async — result via window.routeCallback) ──

  @JavascriptInterface
  fun calculateRouteAsync(lonlats: String, profile: String, alternativeIdx: Int, nogoLonLats: String, callbackId: Int) {
    Log.d(TAG, "calculateRouteAsync called: lonlats=$lonlats, profile=$profile, idx=$alternativeIdx, callbackId=$callbackId")
    activity.lifecycleScope.launch {
      val resultJson = routeService.calculateRoute(lonlats, profile, alternativeIdx, nogoLonLats)
      val jsResult = if (resultJson != null) {
        // Escape for JS: wrap in single quotes and escape special chars
        resultJson
          .replace("\\", "\\\\")
          .replace("'", "\\'")
          .replace("\n", "\\n")
          .replace("\r", "\\r")
      } else {
        "null"
      }
      withContext(Dispatchers.Main) {
        webView.evaluateJavascript("window.routeCallback($callbackId, '$jsResult');", null)
      }
    }
  }

  // ── Data Management ──

  /** Check if local routing data is available. */
  @JavascriptInterface
  fun isLocalRoutingAvailable(): Boolean {
    return routeService.hasAnyData()
  }

  /** Get download status of all regions as JSON array. */
  @JavascriptInterface
  fun getRegionsStatus(): String {
    val regions = dataManager.getRegionsWithStatus()
    val arr = JSONArray()
    for (r in regions) {
      val obj = JSONObject()
      obj.put("id", r.region.id)
      obj.put("displayName", r.region.displayName)
      obj.put("downloadedTiles", r.downloadedTiles)
      obj.put("totalTiles", r.totalTiles)
      obj.put("progress", r.progress)
      obj.put("isFullyDownloaded", r.isFullyDownloaded)
      arr.put(obj)
    }
    return arr.toString()
  }

  /** Get list of downloaded segment file names as JSON array. */
  @JavascriptInterface
  fun getDownloadedSegments(): String {
    val segments = routeService.getDownloadedSegments()
    val arr = JSONArray()
    for (s in segments) arr.put(s)
    return arr.toString()
  }

  /** Get total size of downloaded data in bytes. */
  @JavascriptInterface
  fun getDownloadedDataSize(): Long {
    return routeService.getDownloadedDataSize()
  }

  /** Start downloading a region. Progress reported via window.onDownloadProgress. */
  @JavascriptInterface
  fun downloadRegion(regionId: String) {
    Log.d(TAG, "Starting download for region: $regionId")
    activity.lifecycleScope.launch {
      dataManager.downloadRegion(regionId) { progress ->
        val jsProgress = String.format("%.2f", progress)
        activity.runOnUiThread {
          webView.evaluateJavascript(
            "window.onDownloadProgress('$regionId', $jsProgress);", null
          )
        }
      }
      Log.d(TAG, "Download complete for region: $regionId")
      activity.runOnUiThread {
        webView.evaluateJavascript(
          "window.onDownloadComplete('$regionId');", null
        )
      }
    }
  }

  /** Delete all downloaded routing data. */
  @JavascriptInterface
  fun deleteAllData() {
    dataManager.deleteAllData()
    Log.d(TAG, "All routing data deleted")
  }
}
