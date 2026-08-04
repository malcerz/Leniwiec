package com.example.leniwiec.routing

import android.content.Context
import android.util.Log
import btools.router.FormatJson
import btools.router.OsmNodeNamed
import btools.router.RoutingContext
import btools.router.RoutingEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
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
    nogoLonLats: String = "",
    onProgress: ((linksProcessed: Int, elapsedMs: Long) -> Unit)? = null
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
      rc.localFunction = profile
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

      // Start progress polling coroutine
      val startTime = System.currentTimeMillis()
      val progressJob = onProgress?.let { progressCallback ->
        launch(Dispatchers.Default) {
          while (!engine.isFinished) {
            val elapsed = System.currentTimeMillis() - startTime
            val links = engine.linksProcessed
            progressCallback(links, elapsed)
            delay(200)
          }
        }
      }

      try {
        engine.doRun(ROUTE_TIMEOUT_MS)
      } finally {
        progressJob?.cancel()
        val elapsed = System.currentTimeMillis() - startTime
        onProgress?.invoke(engine.linksProcessed, elapsed)
      }

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
   * Calculate a round-trip (loop) route using BRouter's built-in round-trip
   * engine mode. BRouter generates the loop waypoints on a circle around the
   * start point and soft-snaps them within waypointCatchingRange, so it can
   * follow flat local infrastructure instead of forcing fixed waypoints.
   *
   * @param lat/lon Start point of the loop.
   * @param radiusMeters BRouter round-trip RADIUS (loop length is roughly 5x this).
   * @param startDirection Start bearing in degrees (0-359), or -1 for terrain-aware auto.
   * @param points Number of loop waypoints placed on the circle (3-9).
   * @return GeoJSON string, or null on failure.
   */
  suspend fun calculateRoundTrip(
    lat: Double,
    lon: Double,
    radiusMeters: Int,
    startDirection: Int = -1,
    points: Int = 5,
    profile: String = "trekking",
    onProgress: ((linksProcessed: Int, elapsedMs: Long) -> Unit)? = null
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

      // Configure round-trip routing context (doRoundTrip -> buildPointsFromCircle)
      val rc = RoutingContext()
      rc.localFunction = profile
      rc.roundTripDistance = radiusMeters.coerceIn(300, 100_000)
      rc.roundTripPoints = points.coerceIn(3, 9)
      rc.startDirection = if (startDirection in 0..359) startDirection else null

      // Single start waypoint; BRouter adds the loop points itself
      val startPoint = OsmNodeNamed().apply {
        name = "from"
        ilon = ((lon + 180.0) * 1_000_000 + 0.5).toInt()
        ilat = ((lat + 90.0) * 1_000_000 + 0.5).toInt()
        wpttype = 0
      }

      val engine = RoutingEngine(
        null,
        null,
        segmentsDir,
        mutableListOf(startPoint),
        rc,
        RoutingEngine.BROUTER_ENGINEMODE_ROUNDTRIP
      )
      engine.quite = true

      // Start progress polling coroutine (same as calculateRoute)
      val startTime = System.currentTimeMillis()
      val progressJob = onProgress?.let { progressCallback ->
        launch(Dispatchers.Default) {
          while (!engine.isFinished) {
            val elapsed = System.currentTimeMillis() - startTime
            progressCallback(engine.linksProcessed, elapsed)
            delay(200)
          }
        }
      }

      try {
        engine.doRun(ROUTE_TIMEOUT_MS)
      } finally {
        progressJob?.cancel()
        onProgress?.invoke(engine.linksProcessed, System.currentTimeMillis() - startTime)
      }

      // Check for errors
      val errorMsg = engine.errorMessage
      if (errorMsg != null) {
        Log.w(TAG, "Round-trip routing error: $errorMsg")
        return@withContext null
      }

      // Get result and format as GeoJSON
      val track = engine.foundTrack
      if (track == null || track.nodes.size < 2) {
        Log.w(TAG, "No round-trip track found")
        return@withContext null
      }

      val formatter = FormatJson(rc)
      val geojson = formatter.format(track)
      Log.d(TAG, "Round trip calculated: ${track.distance}m, ascend=${track.ascend}")
      geojson
    } catch (e: Exception) {
      Log.e(TAG, "Round trip calculation failed", e)
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
