// Pure geometry helpers for the loop planner.
// No DOM/Leaflet dependency.
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.RouteGeo = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {

    const EARTH_RADIUS_M = 6371000;

    function toRad(deg) { return deg * Math.PI / 180; }

    // Haversine distance in meters between two [lon, lat] points.
    function distanceMeters(lon1, lat1, lon2, lat2) {
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Generates 3 via points for a forced loop circuit.
     *
     * Geometry:
     *   Cel � at half the total distance from Start in direction angleDeg
     *   P1  � at the midpoint of Start�Cel, offset perpendicularly RIGHT
     *   P2  � at the midpoint of Start�Cel, offset perpendicularly LEFT
     *
     * The route Start � P1 � Cel � P2 � Start has four segments in four
     * distinctly different directions, making road duplication impossible.
     *
     * @param {number} startLat
     * @param {number} startLng
     * @param {number} angleDeg � compass direction in degrees (0 = North)
     * @param {number} totalDistanceMeters � desired total loop distance
     * @param {number} offsetRatio � perpendicular offset as fraction of half-distance (default 0.2)
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

    return { distanceMeters, calculateViaPoints };
});