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
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    // Samples waypoints roughly every `spacingMeters` along a [lon,lat,ele] list,
    // skipping the first/last `edgeSkip` points — used as BRouter nogo circles.
    // NOTE: BRouter nogo circles have a fixed 40m radius (LocalRouteService.kt).
    // spacingMeters MUST stay below 2*40=80 or consecutive circles leave a gap
    // the router can slip through, defeating the whole anti-backtrack mechanism.
    function buildNogoPoints(coordinates, spacingMeters = 50, edgeSkip = 2) {
        const nogoPoints = [];
        let distanceSinceLastPoint = 0;

        for (let i = 1; i < coordinates.length - 1; i++) {
            distanceSinceLastPoint += distanceMeters(
                coordinates[i - 1][0], coordinates[i - 1][1],
                coordinates[i][0], coordinates[i][1]
            );

            if (i > edgeSkip && i < coordinates.length - edgeSkip - 1 && distanceSinceLastPoint >= spacingMeters) {
                nogoPoints.push(`${coordinates[i][0].toFixed(6)},${coordinates[i][1].toFixed(6)}`);
                distanceSinceLastPoint = 0;
            }
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

    return { distanceMeters, bearingDeg, buildNogoPoints, mergeRouteSegments, decimateCoordinates, findRouteOverlap, findDuplicatePoints };
});
