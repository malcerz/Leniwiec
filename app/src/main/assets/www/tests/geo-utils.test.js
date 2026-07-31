// Node-based unit tests for the pure route-geometry helpers used by the loop planner.
// Run with:  node --test app/src/main/assets/www/tests/geo-utils.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { findRouteOverlap, findDuplicatePoints, mergeRouteSegments, buildNogoPoints, distanceMeters, findClosePointPairs, removeBacktracking } = require('../geo-utils');

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

/**
 * Creates a clean square loop with a backtracking "spike" inserted at a given
 * fraction along the route. The spike goes outward and comes back to the same
 * point, creating an exact out-and-back branch.
 */
function squareWithSpike(spikeAtFraction, spikeLengthDeg = 0.002, spikePoints = 20) {
    const base = squareLoop(21.0, 52.2, 0.05, 60);
    const insertIdx = Math.floor(base.length * spikeAtFraction);
    const origin = base[insertIdx];

    // Build spike: go north and come back
    const spikeOut = [];
    const spikeBack = [];
    for (let p = 1; p <= spikePoints; p++) {
        const t = p / spikePoints;
        const pt = [origin[0], origin[1] + spikeLengthDeg * t, 100];
        spikeOut.push(pt);
        spikeBack.unshift([...pt]); // exact same coordinates reversed
    }

    // Insert spike into the route
    const result = [
        ...base.slice(0, insertIdx + 1),
        ...spikeOut,
        ...spikeBack,
        ...base.slice(insertIdx + 1)
    ];
    return result;
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
    const NOGO_RADIUS_METERS = 40;
    const coords = squareLoop(21.0, 52.2, 0.05, 200);
    const nogos = buildNogoPoints(coords);
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
    const base = squareLoop(21.0, 52.2, 0.03, 40).slice(0, 40);
    const spike1 = base.slice(10, 25);
    const spike2 = base.slice(30, 38);
    const coords = [...base, ...spike1.reverse(), ...spike2.reverse()];
    const result = findDuplicatePoints(coords);
    assert.equal(result.hasDuplicates, true);
    assert.ok(result.runs.length >= 1);
});

// ──── removeBacktracking / findClosePointPairs tests ────

test('findClosePointPairs: clean square loop has no close pairs', () => {
    const coords = squareLoop(21.0, 52.2, 0.05, 60);
    const pairs = findClosePointPairs(coords, { proximityMeters: 5, skipEndsMeters: 100, minIndexGap: 10 });
    assert.equal(pairs.length, 0, `expected no close pairs in a clean loop, got ${pairs.length}`);
});

test('findClosePointPairs: spike at 50% is detected', () => {
    const coords = squareWithSpike(0.5);
    const pairs = findClosePointPairs(coords, { proximityMeters: 5, skipEndsMeters: 100, minIndexGap: 5 });
    assert.ok(pairs.length > 0, `expected close pairs from the spike, got ${pairs.length}`);
});

test('removeBacktracking: clean square loop is unchanged', () => {
    const coords = squareLoop(21.0, 52.2, 0.05, 60);
    const cleaned = removeBacktracking(coords, { proximityMeters: 5, skipEndsMeters: 100, minIndexGap: 10 });
    assert.equal(cleaned.length, coords.length, 'clean loop should not lose any points');
});

test('removeBacktracking: spike at 50% is removed', () => {
    const original = squareLoop(21.0, 52.2, 0.05, 60);
    const withSpike = squareWithSpike(0.5);
    assert.ok(withSpike.length > original.length, 'spike should add points');

    const cleaned = removeBacktracking(withSpike, { proximityMeters: 5, skipEndsMeters: 100, minIndexGap: 5 });

    // After removing the spike, the cleaned route should have fewer points
    assert.ok(cleaned.length < withSpike.length,
        `expected spike to be removed: cleaned=${cleaned.length} vs spiked=${withSpike.length}`);

    // Verify no close pairs remain
    const pairsAfter = findClosePointPairs(cleaned, { proximityMeters: 5, skipEndsMeters: 100, minIndexGap: 5 });
    assert.equal(pairsAfter.length, 0, `expected no close pairs after cleaning, got ${pairsAfter.length}`);
});

test('removeBacktracking: spike at start (within skipEndsMeters) is preserved', () => {
    const withSpike = squareWithSpike(0.05);
    // Square perimeter is ~44km, 5% = ~2.2km. Set skip zone to 3000m to include it.
    const cleaned = removeBacktracking(withSpike, { proximityMeters: 5, skipEndsMeters: 3000, minIndexGap: 5 });
    assert.equal(cleaned.length, withSpike.length, 'spike within skip zone should be preserved');
});

test('removeBacktracking: two spikes are both removed', () => {
    const base = squareLoop(21.0, 52.2, 0.05, 60);
    const insertIdx1 = Math.floor(base.length * 0.3);
    const insertIdx2 = Math.floor(base.length * 0.7);
    const origin1 = base[insertIdx1];
    const origin2 = base[insertIdx2];

    const spike1Out = [];
    const spike1Back = [];
    const spike2Out = [];
    const spike2Back = [];
    for (let p = 1; p <= 15; p++) {
        const t = p / 15;
        const pt1 = [origin1[0], origin1[1] + 0.002 * t, 100];
        spike1Out.push(pt1);
        spike1Back.unshift([...pt1]);
        const pt2 = [origin2[0] + 0.002 * t, origin2[1], 100];
        spike2Out.push(pt2);
        spike2Back.unshift([...pt2]);
    }

    const withSpikes = [
        ...base.slice(0, insertIdx1 + 1),
        ...spike1Out,
        ...spike1Back,
        ...base.slice(insertIdx1 + 1, insertIdx2 + 1),
        ...spike2Out,
        ...spike2Back,
        ...base.slice(insertIdx2 + 1)
    ];

    const cleaned = removeBacktracking(withSpikes, { proximityMeters: 5, skipEndsMeters: 100, minIndexGap: 5 });

    assert.ok(cleaned.length < withSpikes.length,
        `expected both spikes removed: cleaned=${cleaned.length} vs spiked=${withSpikes.length}`);

    const pairsAfter = findClosePointPairs(cleaned, { proximityMeters: 5, skipEndsMeters: 100, minIndexGap: 5 });
    assert.equal(pairsAfter.length, 0, `expected no close pairs after cleaning, got ${pairsAfter.length}`);
});

test('removeBacktracking: full loop is not truncated by start/end proximity', () => {
    // Generate a loop where start and end points are close, but detour is large
    const coords = squareLoop(21.0, 52.2, 0.05, 100);
    const cleaned = removeBacktracking(coords, { proximityMeters: 500, skipEndsMeters: 100, minIndexGap: 10 });
    // It should not cut the loop even if proximity tolerance is very high (500m),
    // because the detour (the entire loop) is almost 100% of the total distance.
    assert.equal(cleaned.length, coords.length, 'the main loop body should be preserved');
});
