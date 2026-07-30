package com.example.flatcycle.routing

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.URL

/**
 * Manages downloading and storage of BRouter routing data (.rd5 files).
 *
 * .rd5 files are available from:
 * https://brouter.de/brouter/segments4/
 *
 * Naming convention: {W|E}{lon}_{N|S}{lat}.rd5
 * e.g. W15_N45.rd5, E10_N55.rd5
 *
 * Each file covers a 5°x5° tile. Poland is covered by approximately:
 * - W15_N50.rd5, W10_N50.rd5, W05_N50.rd5
 * - W15_N55.rd5, W10_N55.rd5, W05_N55.rd5
 * - E15_N50.rd5, E20_N50.rd5, E25_N50.rd5
 * - E15_N55.rd5, E20_N55.rd5, E25_N55.rd5
 */
class RouteDataManager(private val appContext: Context) {

  companion object {
    private const val TAG = "RouteDataManager"
    private const val SEGMENTS_DIR = "brouter/segments4"
    private const val BASE_URL = "https://brouter.de/brouter/segments4"

    // Common regions with their required tiles
    val REGIONS = listOf(
      RegionInfo("Polska (cała)", "pl", listOf(
        "W15_N50.rd5", "W10_N50.rd5", "W05_N50.rd5",
        "W15_N55.rd5", "W10_N55.rd5", "W05_N55.rd5",
        "E15_N50.rd5", "E20_N50.rd5", "E25_N50.rd5",
        "E15_N55.rd5", "E20_N55.rd5", "E25_N55.rd5"
      )),
      RegionInfo("Europa Środkowa", "central-europe", listOf(
        "W15_N45.rd5", "W10_N45.rd5", "W05_N45.rd5", "E00_N45.rd5", "E05_N45.rd5", "E10_N45.rd5", "E15_N45.rd5", "E20_N45.rd5",
        "W15_N50.rd5", "W10_N50.rd5", "W05_N50.rd5", "E00_N50.rd5", "E05_N50.rd5", "E10_N50.rd5", "E15_N50.rd5", "E20_N50.rd5",
        "W15_N55.rd5", "W10_N55.rd5", "W05_N55.rd5", "E00_N55.rd5", "E05_N55.rd5", "E10_N55.rd5", "E15_N55.rd5", "E20_N55.rd5"
      )),
      RegionInfo("Niemcy", "de", listOf(
        "W15_N45.rd5", "W10_N45.rd5", "W05_N45.rd5",
        "W15_N50.rd5", "W10_N50.rd5", "W05_N50.rd5",
        "E00_N50.rd5", "E05_N50.rd5", "E10_N50.rd5",
        "E00_N55.rd5", "E05_N55.rd5", "E10_N55.rd5"
      )),
      RegionInfo("Czechy/Słowacja", "cz-sk", listOf(
        "W15_N45.rd5", "W10_N45.rd5", "E00_N45.rd5",
        "W15_N50.rd5", "W10_N50.rd5", "E00_N50.rd5",
        "E15_N50.rd5", "E20_N50.rd5",
        "E15_N45.rd5", "E20_N45.rd5"
      )),
      RegionInfo("Francja", "fr", listOf(
        "W05_N45.rd5", "W05_N40.rd5", "W05_N50.rd5",
        "E00_N45.rd5", "E00_N40.rd5", "E00_N50.rd5",
        "E05_N45.rd5", "E05_N40.rd5", "E05_N50.rd5"
      )),
      RegionInfo("Wielka Brytania", "uk", listOf(
        "W10_N50.rd5", "W05_N50.rd5", "E00_N50.rd5",
        "W10_N55.rd5", "W05_N55.rd5", "E00_N55.rd5"
      )),
      RegionInfo("Europa Zachodnia", "western-europe", listOf(
        "W15_N45.rd5", "W10_N45.rd5", "W05_N45.rd5", "E00_N45.rd5",
        "W15_N40.rd5", "W10_N40.rd5", "W05_N40.rd5", "E00_N40.rd5",
        "W15_N50.rd5", "W10_N50.rd5", "W05_N50.rd5", "E00_N50.rd5",
        "W15_N55.rd5", "W10_N55.rd5", "W05_N55.rd5", "E00_N55.rd5"
      ))
    )
  }

  data class RegionInfo(
    val displayName: String,
    val id: String,
    val tiles: List<String>
  )

  /**
   * Get list of all available regions with download status.
   */
  fun getRegionsWithStatus(): List<RegionStatus> {
    val downloaded = getDownloadedTileNames().toSet()
    return REGIONS.map { region ->
      val downloadedTiles = region.tiles.filter { it in downloaded }
      RegionStatus(
        region = region,
        isFullyDownloaded = downloadedTiles.size == region.tiles.size,
        downloadedTiles = downloadedTiles.size,
        totalTiles = region.tiles.size
      )
    }
  }

  data class RegionStatus(
    val region: RegionInfo,
    val isFullyDownloaded: Boolean,
    val downloadedTiles: Int,
    val totalTiles: Int
  ) {
    val progress: Float get() = if (totalTiles > 0) downloadedTiles.toFloat() / totalTiles else 0f
  }

  /**
   * Download all tiles for a region.
   * @param regionId Region ID to download
   * @param onProgress Progress callback (0.0 to 1.0)
   */
  suspend fun downloadRegion(
    regionId: String,
    onProgress: (Float) -> Unit = {}
  ): Boolean = withContext(Dispatchers.IO) {
    try {
      val region = REGIONS.find { it.id == regionId }
      if (region == null) {
        Log.e(TAG, "Unknown region: $regionId")
        return@withContext false
      }

      val segmentsDir = File(appContext.filesDir, SEGMENTS_DIR)
      segmentsDir.mkdirs()

      val totalTiles = region.tiles.size
      var completed = 0

      for (tileName in region.tiles) {
        val targetFile = File(segmentsDir, tileName)
        if (targetFile.exists()) {
          completed++
          onProgress(completed.toFloat() / totalTiles)
          continue
        }

        try {
          val url = URL("$BASE_URL/$tileName")
          url.openStream().use { input ->
            FileOutputStream(targetFile).use { output ->
              input.copyTo(output)
            }
          }
          Log.d(TAG, "Downloaded: $tileName (${targetFile.length()} bytes)")
        } catch (e: Exception) {
          Log.w(TAG, "Failed to download $tileName: ${e.message}")
          // Continue with other tiles — some may not exist
        }

        completed++
        onProgress(completed.toFloat() / totalTiles)
      }

      true
    } catch (e: Exception) {
      Log.e(TAG, "Region download failed", e)
      false
    }
  }

  /**
   * Get list of downloaded tile file names.
   */
  private fun getDownloadedTileNames(): List<String> {
    val segmentsDir = File(appContext.filesDir, SEGMENTS_DIR)
    if (!segmentsDir.exists()) return emptyList()
    return segmentsDir.listFiles()
      ?.filter { it.name.endsWith(".rd5") && it.length() > 0 }
      ?.map { it.name }
      ?.sorted() ?: emptyList()
  }

  /**
   * Delete all downloaded routing data.
   */
  fun deleteAllData() {
    val segmentsDir = File(appContext.filesDir, SEGMENTS_DIR)
    if (segmentsDir.exists()) {
      segmentsDir.listFiles()?.forEach { it.delete() }
      Log.d(TAG, "All routing data deleted")
    }
  }

  /**
   * Get total storage used by routing data.
   */
  fun getTotalSize(): Long {
    val segmentsDir = File(appContext.filesDir, SEGMENTS_DIR)
    if (!segmentsDir.exists()) return 0L
    return segmentsDir.listFiles()
      ?.filter { it.name.endsWith(".rd5") }
      ?.sumOf { it.length() } ?: 0L
  }
}
