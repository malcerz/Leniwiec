// Pure geometry helpers shared by the WebView app and Node-based tests.
// No DOM/Leaflet dependency — works as window.RouteGeo in the browser and
// via require() in Node (see tests/geo-utils.test.js).
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.RouteGeo = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {

    const EARTH_RADIUS_M = 6371000;

    function toRad(deg) { return deg * Math.PI / 180; }
    function toDeg(rad) { return rad * 180 / Math.PI; }

    // Haversine distance in meters between two [lon, lat] points.
    function distanceMeters(lon1, lat1, lon2, lat2) {
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Initial bearing in degrees [0, 360) from point1 to point2.
    function bearingDeg(lon1, lat1, lon2, lat2) {
        const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
        const brng = Math.atan2(y, x);
        return (toDeg(brng) + 360) % 360;
    }

    /**
     * Generates 3 via points for a forced loop circuit.
     *
     * Geometry:
     *   Cel – at half the total distance from Start in direction angleDeg
     *   P1  – at the midpoint of Start–Cel, offset perpendicularly RIGHT
     *   P2  – at the midpoint of Start–Cel, offset perpendicularly LEFT
     *
     * The route Start → P1 → Cel → P2 → Start has four segments in four
     * distinctly different directions, making road duplication impossible.
     *
     * @param {number} startLat
     * @param {number} startLng
     * @param {number} angleDeg – compass direction in degrees (0 = North)
     * @param {number} totalDistanceMeters – desired total loop distance
     * @param {number} offsetRatio – perpendicular offset as fraction of half-distance (default 0.2)
     * @returns {{ cel: {lat,lng}, p1: {lat,lng}, p2: {lat,lng} }}
     */
    function calculateViaPoints(startLat, startLng, angleDeg, totalDistanceMeters, _offsetRatio) {
        const sideLen = totalDistanceMeters / 4;
        const latRad = toRad(startLat);
        const angleRad = toRad(angleDeg);
        const cosLat = Math.cos(latRad);

        const sx = (sideLen / 111320) * Math.cos(angleRad);
        const sy = (sideLen / (111320 * cosLat)) * Math.sin(angleRad);

        const px = -(sideLen / 111320) * Math.sin(angleRad);
        const py = (sideLen / (111320 * cosLat)) * Math.cos(angleRad);

        return {
            p1: { lat: startLat + sx, lng: startLng + sy },
            cel: { lat: startLat + sx + px, lng: startLng + sy + py },
            p2: { lat: startLat + px, lng: startLng + py }
        };
    }

    /**
     * Removes backtracking branches from a route by detecting when a point
     * appears twice (within proximityMeters) with a detour between them.
     *
     * Example:  a b c c1 c2 c3 c2 c1 d
     *                       |--detour--|
     *           Result: a b c c1 d
     *
     * @param {Array} coordinates – [[lon,lat,ele], …]
     * @param {number} proximityMeters – max distance for a "duplicate" (default 25)
     * @param {number} minDetourPoints – min points in detour to consider cutting (default 4)
     * @returns {Array} trimmed coordinates
     */
    function trimDuplicates(coordinates, proximityMeters = 40, minDetourPoints = 2) {
        if (!coordinates || coordinates.length < minDetourPoints * 2) return coordinates;
        const result = [...coordinates];
        let i = 0;
        while (i < result.length) {
            let found = false;
            for (let j = i + minDetourPoints; j < result.length; j++) {
                const dist = distanceMeters(
                    result[i][0], result[i][1],
                    result[j][0], result[j][1]
                );
                
                if (dist <= proximityMeters) {
                    // Calculate path distance of the proposed cut (detour)
                    let detourDist = 0;
                    for (let k = i; k < j; k++) {
                        detourDist += distanceMeters(result[k][0], result[k][1], result[k+1][0], result[k+1][1]);
                    }
                    
                    // Calculate the total distance of the current route
                    let currentTotalDist = 0;
                    for (let k = 0; k < result.length - 1; k++) {
                        currentTotalDist += distanceMeters(result[k][0], result[k][1], result[k+1][0], result[k+1][1]);
                    }
                    
                    // If the detour is more than 30% of the total route length,
                    // it is likely the main loop itself (or a huge chunk of it) touching the start path,
                    // rather than a simple backtracking "spike". We must preserve it!
                    if (detourDist > currentTotalDist * 0.30) {
                        continue;
                    }
                    
                    result.splice(i + 1, j - i);
                    found = true;
                    break;
                }
            }
            if (!found) i++;
        }
        return result;
    }

    // Samples waypoints exactly every `spacingMeters` along a polyline by interpolating.
    // Skips placing points within `skipEndsMeters` from the absolute start and end of the polyline,
    // so we don't block the very intersections we are trying to route from/to.
    function buildNogoPoints(coordinates, spacingMeters = 40, skipEndsMeters = 150) {
        if (!coordinates || coordinates.length < 2) return [];
        
        // Calculate lengths of all segments and total length
        let totalLength = 0;
        const segmentLengths = [];
        for (let i = 0; i < coordinates.length - 1; i++) {
            const dist = distanceMeters(
                coordinates[i][0], coordinates[i][1],
                coordinates[i+1][0], coordinates[i+1][1]
            );
            totalLength += dist;
            segmentLengths.push(dist);
        }

        const nogoPoints = [];
        let currentPos = 0; // Distance along the entire polyline
        let nextTarget = spacingMeters; // The target distance for the next nogo point

        for (let i = 0; i < coordinates.length - 1; i++) {
            const segLen = segmentLengths[i];
            
            // While the next target distance falls within the current segment
            while (nextTarget <= currentPos + segLen) {
                // Check if it's outside the skip zones at the very beginning and end
                if (nextTarget >= skipEndsMeters && nextTarget <= totalLength - skipEndsMeters) {
                    // Interpolate coordinate between point i and i+1
                    const ratio = segLen === 0 ? 0 : (nextTarget - currentPos) / segLen;
                    const lon = coordinates[i][0] + ratio * (coordinates[i+1][0] - coordinates[i][0]);
                    const lat = coordinates[i][1] + ratio * (coordinates[i+1][1] - coordinates[i][1]);
                    nogoPoints.push(`${lon.toFixed(6)},${lat.toFixed(6)}`);
                }
                nextTarget += spacingMeters;
            }
            currentPos += segLen;
        }

        return nogoPoints;
    }

    // Stitches GeoJSON LineString "leg" results into one continuous FeatureCollection,
    // dropping the duplicated joint point between consecutive legs.
    function mergeRouteSegments(segments) {
        const coordinates = [];
        segments.forEach((segment, segmentIndex) => {
            const segmentCoordinates = segment.features[0].geometry.coordinates;
            coordinates.push(...(segmentIndex === 0 ? segmentCoordinates : segmentCoordinates.slice(1)));
        });

        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates }
            }]
        };
    }

    // Reduces a coordinate list to at most `maxPoints` (evenly spaced) so the
    // O(n^2) overlap scan below stays fast on long routes.
    function decimateCoordinates(coordinates, maxPoints) {
        if (coordinates.length <= maxPoints) return coordinates;
        const step = coordinates.length / maxPoints;
        const out = [];
        for (let i = 0; i < maxPoints; i++) {
            out.push(coordinates[Math.floor(i * step)]);
        }
        out.push(coordinates[coordinates.length - 1]);
        return out;
    }

    /**
     * Detects whether a route polyline backtracks over itself: two segments far
     * apart in the path sequence running physically on top of each other (same
     * or opposite direction). Used to reject loop candidates that "duplicate"
     * a road instead of forming a real circuit.
     *
     * Returns { hasOverlap, overlapMeters, overlapRatio, overlaps: [{i, j, distanceMeters}] }
     */
    function findRouteOverlap(coordinates, options = {}) {
        const proximityMeters = options.proximityMeters ?? 18;
        const parallelToleranceDeg = options.parallelToleranceDeg ?? 20;
        const overlapRatioThreshold = options.overlapRatioThreshold ?? 0.08;
        const maxPointsForScan = options.maxPointsForScan ?? 200;

        const sample = decimateCoordinates(coordinates, maxPointsForScan);
        const minIndexGap = options.minIndexGap ?? Math.max(8, Math.floor(sample.length * 0.08));

        if (!sample || sample.length < minIndexGap * 2) {
            return { hasOverlap: false, overlapMeters: 0, overlapRatio: 0, overlaps: [] };
        }

        const segments = [];
        let totalLength = 0;
        for (let i = 0; i < sample.length - 1; i++) {
            const [lon1, lat1] = sample[i];
            const [lon2, lat2] = sample[i + 1];
            const length = distanceMeters(lon1, lat1, lon2, lat2);
            totalLength += length;
            segments.push({
                index: i,
                midLon: (lon1 + lon2) / 2,
                midLat: (lat1 + lat2) / 2,
                bearing: bearingDeg(lon1, lat1, lon2, lat2),
                length
            });
        }

        const overlaps = [];
        let overlapMeters = 0;

        for (let i = 0; i < segments.length; i++) {
            for (let j = i + minIndexGap; j < segments.length; j++) {
                const segA = segments[i];
                const segB = segments[j];

                const dist = distanceMeters(segA.midLon, segA.midLat, segB.midLon, segB.midLat);
                if (dist > proximityMeters) continue;

                // The same road can be re-traversed forwards (parallel) or
                // backwards (anti-parallel) — both count as a duplicate.
                const bearingDiff = Math.abs(segA.bearing - segB.bearing) % 360;
                const angleDiff = Math.min(bearingDiff, 360 - bearingDiff);
                const isParallel = angleDiff <= parallelToleranceDeg || Math.abs(angleDiff - 180) <= parallelToleranceDeg;

                if (isParallel) {
                    overlaps.push({ i: segA.index, j: segB.index, distanceMeters: dist });
                    overlapMeters += Math.min(segA.length, segB.length);
                }
            }
        }

        const overlapRatio = totalLength > 0 ? overlapMeters / totalLength : 0;

        return {
            hasOverlap: overlapRatio >= overlapRatioThreshold,
            overlapMeters: Math.round(overlapMeters),
            overlapRatio,
            overlaps
        };
    }

    /**
     * Literal point-by-point duplicate check: for every point, looks for another
     * point that is physically close (proximityMeters) but far away along the
     * path (minPathGapMeters of travel between them). Consecutive matches are
     * grouped into "runs" — a run means a real stretch of road was traversed
     * twice, as opposed to a single coincidental crossing (e.g. an underpass),
     * which is intentionally ignored via minRunLength.
     *
     * Returns { hasDuplicates, runs: [{start, end, length}], totalDuplicatedPoints }
     */
    function findDuplicatePoints(coordinates, options = {}) {
        const proximityMeters = options.proximityMeters ?? 25;
        const minPathGapMeters = options.minPathGapMeters ?? 300;
        const minRunLength = options.minRunLength ?? 3;
        const maxPointsForScan = options.maxPointsForScan ?? 400;

        const sample = decimateCoordinates(coordinates, maxPointsForScan);
        if (sample.length < minRunLength * 2) {
            return { hasDuplicates: false, runs: [], totalDuplicatedPoints: 0 };
        }

        const cumulative = [0];
        for (let i = 1; i < sample.length; i++) {
            cumulative.push(cumulative[i - 1] + distanceMeters(
                sample[i - 1][0], sample[i - 1][1], sample[i][0], sample[i][1]
            ));
        }

        const matchOf = new Array(sample.length).fill(-1);
        for (let i = 0; i < sample.length; i++) {
            for (let j = i + 1; j < sample.length; j++) {
                if (cumulative[j] - cumulative[i] < minPathGapMeters) continue;
                const dist = distanceMeters(sample[i][0], sample[i][1], sample[j][0], sample[j][1]);
                if (dist <= proximityMeters) {
                    matchOf[i] = j;
                    break; // nearest-in-index match beyond the gap is enough
                }
            }
        }

        const runs = [];
        let runStart = -1;
        for (let i = 0; i <= sample.length; i++) {
            const matched = i < sample.length && matchOf[i] !== -1;
            if (matched && runStart === -1) runStart = i;
            if (!matched && runStart !== -1) {
                const runLength = i - runStart;
                if (runLength >= minRunLength) {
                    runs.push({ start: runStart, end: i - 1, length: runLength });
                }
                runStart = -1;
            }
        }

        return {
            hasDuplicates: runs.length > 0,
            runs,
            totalDuplicatedPoints: runs.reduce((sum, r) => sum + r.length, 0)
        };
    }

    return {
        distanceMeters,
        bearingDeg,
        calculateViaPoints,
        trimDuplicates,
        buildNogoPoints,
        mergeRouteSegments,
        decimateCoordinates,
        findRouteOverlap,
        findDuplicatePoints
    };
});