package com.example.flatcycle.routing

import android.content.Context
import android.util.Log
import btools.router.FormatJson
import btools.router.OsmNodeNamed
import btools.router.RoutingContext
import btools.router.RoutingEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Local route calculation service that wraps BRouter engine.
 * After one-time data download (segments4 .rd5 files), works fully offline.
 */
class LocalRouteService(private val appContext: Context) {

  companion object {
    private const val TAG = "LocalRouteService"
    private const val PROFILES_DIR = "brouter/profiles2"
    private const val SEGMENTS_DIR = "brouter/segments4"
    private const val ROUTE_TIMEOUT_MS = 5_000L
  }

  private var initialized = false

  /**
   * Initialize the service: copy profiles from assets and set system properties.
   * Must be called once before first route calculation.
   */
  fun initialize() {
    if (initialized) return

    val dataDir = File(appContext.filesDir, "brouter")
    val profilesDir = File(dataDir, "profiles2")
    val segmentsDir = File(dataDir, "segments4")

    // Ensure directories exist
    profilesDir.mkdirs()
    segmentsDir.mkdirs()

    // Copy profiles from assets to internal storage if not already present
    if (!File(profilesDir, "trekking.brf").exists()) {
      copyProfilesFromAssets(profilesDir)
    }

    // Set system properties for BRouter
    System.setProperty("profileBaseDir", profilesDir.absolutePath)

    initialized = true
    Log.d(TAG, "Initialized. Profiles: ${profilesDir.absolutePath}, Segments: ${segmentsDir.absolutePath}")
  }

  /**
   * Check if routing data (.rd5 files) are available for any region.
   */
  fun hasAnyData(): Boolean {
    val segmentsDir = File(appContext.filesDir, "$SEGMENTS_DIR")
    if (!segmentsDir.exists()) return false
    return segmentsDir.listFiles()?.any { it.name.endsWith(".rd5") } == true
  }

  /**
   * Get list of downloaded region files.
   */
  fun getDownloadedSegments(): List<String> {
    val segmentsDir = File(appContext.filesDir, "$SEGMENTS_DIR")
    if (!segmentsDir.exists()) return emptyList()
    return segmentsDir.listFiles()
      ?.filter { it.name.endsWith(".rd5") }
      ?.map { it.name }
      ?.sorted() ?: emptyList()
  }

  /**
   * Get total size of downloaded data in bytes.
   */
  fun getDownloadedDataSize(): Long {
    val segmentsDir = File(appContext.filesDir, "$SEGMENTS_DIR")
    if (!segmentsDir.exists()) return 0L
    return segmentsDir.listFiles()
      ?.filter { it.name.endsWith(".rd5") }
      ?.sumOf { it.length() } ?: 0L
  }

  /**
   * Calculate a route using the local BRouter engine.
   *
   * @param lonlats Waypoints in BRouter format: "lon1,lat1|lon2,lat2|..."
   * @param profile Profile name (e.g. "trekking", "fastbike")
   * @param alternativeIdx Alternative index (0, 1, 2)
   * @return GeoJSON string (same format as brouter.de API), or null on failure
   */
  suspend fun calculateRoute(
    lonlats: String,
    profile: String = "trekking",
    alternativeIdx: Int = 0,
    nogoLonLats: String = ""
  ): String? = withContext(Dispatchers.Default) {
    try {
      initialize()

      val segmentsDir = File(appContext.filesDir, "$SEGMENTS_DIR")
      val profilesDir = File(appContext.filesDir, "$PROFILES_DIR")
      val profileFile = File(profilesDir, "$profile.brf")

      if (!profileFile.exists()) {
        Log.e(TAG, "Profile not found: ${profileFile.absolutePath}")
        return@withContext null
      }

      if (!hasAnyData()) {
        Log.e(TAG, "No routing data (.rd5) available. Download segments first.")
        return@withContext null
      }

      // Parse waypoints from lonlats string
      val waypoints = parseLonLats(lonlats)

      // Configure routing context
      val rc = RoutingContext()
      rc.localFunction = profileFile.absolutePath
      rc.alternativeIdx = alternativeIdx
      val nogoPoints = parseNogoPoints(nogoLonLats)
      if (nogoPoints.isNotEmpty()) {
        RoutingContext.prepareNogoPoints(nogoPoints)
        rc.nogopoints = nogoPoints
      }

      // Create and run the engine
      val engine = RoutingEngine(
        null,                                   // outfileBase — no file output
        null,                                   // logfileBase
        segmentsDir,                            // segmentDir — .rd5 files
        waypoints,
        rc
      )
      engine.quite = true
      engine.doRun(ROUTE_TIMEOUT_MS)

      // Check for errors
      val errorMsg = engine.errorMessage
      if (errorMsg != null) {
        Log.w(TAG, "Routing error: $errorMsg")
        return@withContext null
      }

      // Get result and format as GeoJSON
      val track = engine.foundTrack
      if (track == null || track.nodes.size < 2) {
        Log.w(TAG, "No track found")
        return@withContext null
      }

      val formatter = FormatJson(rc)
      val geojson = formatter.format(track)
      Log.d(TAG, "Route calculated: ${track.distance}m, ascend=${track.ascend}")
      geojson
    } catch (e: Exception) {
      Log.e(TAG, "Route calculation failed", e)
      null
    }
  }

  /**
   * Parse BRouter lonlats format into list of OsmNodeNamed.
   * Format: "lon1,lat1|lon2,lat2|lon3,lat3|..."
   */
  private fun parseLonLats(lonlats: String): List<OsmNodeNamed> {
    val parts = lonlats.split("|")
    return parts.mapIndexed { index, part ->
      val coords = part.trim().split(",")
      if (coords.size < 2) throw IllegalArgumentException("Invalid lonlats format: $part")

      val lon = coords[0].toDouble()
      val lat = coords[1].toDouble()

      OsmNodeNamed().apply {
        name = when (index) {
          0 -> "from"
          parts.size - 1 -> "to"
          else -> "via$index"
        }
        ilon = ((lon + 180.0) * 1_000_000 + 0.5).toInt()
        ilat = ((lat + 90.0) * 1_000_000 + 0.5).toInt()
        // First and last are waypoints, intermediate are shaping points
        if (index == 0 || index == parts.size - 1) {
          wpttype = 0 // MatchedWaypoint.WAYPOINT_TYPE_FIXED (value 0)
        } else {
          wpttype = 2 // MatchedWaypoint.WAYPOINT_TYPE_SHAPING
        }
      }
    }
  }

  /** Parse sampled route points into BRouter hard no-go circles. */
  private fun parseNogoPoints(nogoLonLats: String): List<OsmNodeNamed> {
    if (nogoLonLats.isBlank()) return emptyList()

    return nogoLonLats.split("|").mapNotNull { part ->
      val coords = part.trim().split(",")
      if (coords.size < 2) return@mapNotNull null

      val lon = coords[0].toDoubleOrNull() ?: return@mapNotNull null
      val lat = coords[1].toDoubleOrNull() ?: return@mapNotNull null
      OsmNodeNamed().apply {
        // Radius must stay > half the sampling spacing (see geo-utils.js buildNogoPoints)
        // so consecutive circles overlap and form a continuous barrier, not a dashed line.
        name = "nogo40"
        ilon = ((lon + 180.0) * 1_000_000 + 0.5).toInt()
        ilat = ((lat + 90.0) * 1_000_000 + 0.5).toInt()
        isNogo = true
        nogoWeight = Double.NaN
      }
    }
  }

  /**
   * Copy profile files from app assets to internal storage.
   */
  private fun copyProfilesFromAssets(targetDir: File) {
    try {
      val assets = appContext.assets
      val profileAssets = assets.list(PROFILES_DIR) ?: return
      for (fileName in profileAssets) {
        val sourcePath = "$PROFILES_DIR/$fileName"
        val targetFile = File(targetDir, fileName)
        try {
          assets.open(sourcePath).use { input ->
            targetFile.outputStream().use { output ->
              input.copyTo(output)
            }
          }
          Log.d(TAG, "Copied profile: $fileName")
        } catch (e: Exception) {
          Log.w(TAG, "Failed to copy profile: $fileName", e)
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to copy profiles from assets", e)
    }
  }
}
