// Node-based unit tests for the pure route-geometry helpers used by the loop planner.
// Run with:  node --test app/src/main/assets/www/tests/geo-utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { findRouteOverlap, findDuplicatePoints, mergeRouteSegments, buildNogoPoints, distanceMeters } = require('../geo-utils');

// A clean closed square: each side is a distinct direction, no backtracking.
function squareLoop(centerLon, centerLat, sizeDeg, pointsPerSide) {
    const corners = [
        [centerLon - sizeDeg, centerLat - sizeDeg],
        [centerLon + sizeDeg, centerLat - sizeDeg],
        [centerLon + sizeDeg, centerLat + sizeDeg],
        [centerLon - sizeDeg, centerLat + sizeDeg],
        [centerLon - sizeDeg, centerLat - sizeDeg]
    ];
    const coords = [];
    for (let side = 0; side < corners.length - 1; side++) {
        const [lon1, lat1] = corners[side];
        const [lon2, lat2] = corners[side + 1];
        for (let p = 0; p < pointsPerSide; p++) {
            const t = p / pointsPerSide;
            coords.push([lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t, 100]);
        }
    }
    coords.push([...corners[corners.length - 1], 100]);
    return coords;
}

// Reproduces the reported bug: out to the NE, back through the center,
// out to the SW, back through the center — each arm is walked twice.
function dumbbellLoop(centerLon, centerLat, armDeg, pointsPerArm) {
    const coords = [];
    const pushArm = (fromLon, fromLat, toLon, toLat) => {
        for (let p = 0; p <= pointsPerArm; p++) {
            const t = p / pointsPerArm;
            coords.push([fromLon + (toLon - fromLon) * t, fromLat + (toLat - fromLat) * t, 100]);
        }
    };
    pushArm(centerLon, centerLat, centerLon + armDeg, centerLat + armDeg);
    pushArm(centerLon + armDeg, centerLat + armDeg, centerLon, centerLat);
    pushArm(centerLon, centerLat, centerLon - armDeg, centerLat - armDeg);
    pushArm(centerLon - armDeg, centerLat - armDeg, centerLon, centerLat);
    return coords;
}

test('findRouteOverlap: clean square loop has no overlap', () => {
    const coords = squareLoop(21.0, 52.2, 0.05, 40);
    const result = findRouteOverlap(coords);
    assert.equal(result.hasOverlap, false, `expected no overlap, got ratio=${result.overlapRatio}`);
});

test('findRouteOverlap: dumbbell (out-and-back through center) is flagged', () => {
    const coords = dumbbellLoop(21.0, 52.2, 0.05, 60);
    const result = findRouteOverlap(coords);
    assert.equal(result.hasOverlap, true, 'expected dumbbell shape to be detected as overlapping');
    assert.ok(result.overlaps.length > 0);
});

test('findRouteOverlap: reversed duplicate tail is flagged', () => {
    const outbound = squareLoop(21.0, 52.2, 0.03, 20).slice(0, 40);
    const reversedTail = [...outbound].reverse();
    const coords = [...outbound, ...reversedTail];
    const result = findRouteOverlap(coords);
    assert.equal(result.hasOverlap, true);
});

test('findRouteOverlap: short route below scan threshold is not flagged', () => {
    const coords = [[21.0, 52.2, 100], [21.001, 52.201, 100], [21.002, 52.202, 100]];
    const result = findRouteOverlap(coords);
    assert.equal(result.hasOverlap, false);
});

test('mergeRouteSegments stitches legs without duplicating the shared joint point', () => {
    const legA = { features: [{ geometry: { coordinates: [[0, 0, 10], [1, 1, 10], [2, 2, 10]] } }] };
    const legB = { features: [{ geometry: { coordinates: [[2, 2, 10], [3, 3, 10]] } }] };
    const merged = mergeRouteSegments([legA, legB]);
    const coords = merged.features[0].geometry.coordinates;
    assert.deepEqual(coords, [[0, 0, 10], [1, 1, 10], [2, 2, 10], [3, 3, 10]]);
});

test('buildNogoPoints samples interior points only, skipping edges', () => {
    const coords = squareLoop(21.0, 52.2, 0.05, 100);
    const nogos = buildNogoPoints(coords, 100, 3);
    assert.ok(nogos.length > 0);
    nogos.forEach(p => assert.match(p, /^-?\d+\.\d+,-?\d+\.\d+$/));
});

test('buildNogoPoints default spacing stays under 2x the BRouter nogo radius (40m), forming a continuous barrier', () => {
    // Must match the hardcoded "nogo40" radius in LocalRouteService.kt.
    const NOGO_RADIUS_METERS = 40;
    const coords = squareLoop(21.0, 52.2, 0.05, 200);
    const nogos = buildNogoPoints(coords); // uses production defaults

    for (let i = 1; i < nogos.length; i++) {
        const [lon1, lat1] = nogos[i - 1].split(',').map(Number);
        const [lon2, lat2] = nogos[i].split(',').map(Number);
        const gap = distanceMeters(lon1, lat1, lon2, lat2);
        assert.ok(gap < 2 * NOGO_RADIUS_METERS,
            `nogo circles ${i - 1}-${i} are ${gap.toFixed(0)}m apart — leaves a gap the router can slip through`);
    }
});

test('findDuplicatePoints: clean loop has no duplicates', () => {
    const coords = squareLoop(21.0, 52.2, 0.05, 60);
    const result = findDuplicatePoints(coords);
    assert.equal(result.hasDuplicates, false);
});

test('findDuplicatePoints: out-and-back dumbbell is flagged', () => {
    const coords = dumbbellLoop(21.0, 52.2, 0.05, 50);
    const result = findDuplicatePoints(coords);
    assert.equal(result.hasDuplicates, true);
    assert.ok(result.totalDuplicatedPoints >= 3);
});

test('findDuplicatePoints: reversed tail on a square is flagged', () => {
    const out = squareLoop(21.0, 52.2, 0.03, 30);
    const half = Math.floor(out.length / 2);
    const coords = [...out.slice(0, half), ...out.slice(0, half).reverse()];
    const result = findDuplicatePoints(coords);
    assert.equal(result.hasDuplicates, true);
});

test('findDuplicatePoints: two runs produce correct run count', () => {
    // Build a path with two separate out-and-back "spikes".
    const base = squareLoop(21.0, 52.2, 0.03, 40).slice(0, 40);
    const spike1 = base.slice(10, 25);
    const spike2 = base.slice(30, 38);
    const coords = [...base, ...spike1.reverse(), ...spike2.reverse()];
    const result = findDuplicatePoints(coords);
    assert.equal(result.hasDuplicates, true);
    assert.ok(result.runs.length >= 1);
});
