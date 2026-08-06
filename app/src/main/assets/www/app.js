// Global Variables
let map;
let startMarker = null;
let endMarker = null;
let activeInput = null;
let routesData = []; // Stores the 3 fetched routes
let mapRoutes = []; // Stores Leaflet polyline objects
let elevationChart = null;
let hoverMarker = null;
let currentMode = 'ab'; // 'ab' or 'loop'
// Store per‑route speed (k‑links/s)
let routeSpeeds = {};


// Local routing async callback mechanism
let routingCallbackId = 0;
const routingCallbacks = {};
const activeRoutingProgress = {};

// Bottom inset (px) set by Android so bottom panels stay above the navigation bar
window.setBottomInset = function(px) {
    document.documentElement.style.setProperty('--bottom-inset', (px || 0) + 'px');
};

// Called by Android native code when local route calculation completes
window.routeCallback = function(callbackId, geojsonStr) {
    const cb = routingCallbacks[callbackId];
    delete activeRoutingProgress[callbackId];
    if (cb) {
        if (geojsonStr && geojsonStr !== 'null') {
            try {
                const geojson = JSON.parse(geojsonStr);
                if (geojson) {
                    cb.resolve(geojson);
                } else {
                    cb.reject(new Error("Local routing returned null"));
                }
            } catch (e) {
                cb.reject(new Error("Failed to parse GeoJSON from local router"));
            }
        } else {
            cb.reject(new Error("Local routing returned null"));
        }
        delete routingCallbacks[callbackId];
    }
};

window.onRoutingProgress = function(callbackId, linksProcessed, elapsedMs) {
    if (activeRoutingProgress[callbackId]) {
        activeRoutingProgress[callbackId] = { linksProcessed, elapsedMs };
        // Compute speed for this route and store
        const seconds = elapsedMs / 1000;
        const speedK = (linksProcessed / seconds) / 1000;
        routeSpeeds[callbackId] = speedK;
        updateLoaderProgressText();
    }
};


function updateLoaderProgressText() {
    let totalLinks = 0;
    let maxElapsed = 0;
    let count = 0;
    for (const id in activeRoutingProgress) {
        const progress = activeRoutingProgress[id];
        totalLinks += progress.linksProcessed;
        if (progress.elapsedMs > maxElapsed) {
            maxElapsed = progress.elapsedMs;
        }
        count++;
    }
    if (count > 0 && maxElapsed > 0) {
        const seconds = maxElapsed / 1000;
        const speedK = (totalLinks / seconds) / 1000;
        const loaderText = document.querySelector('#loader .loader-text');
        if (loaderText) {
            const baseText = loaderText.textContent.split('(')[0].trim();
            loaderText.textContent = `${baseText} (${speedK.toFixed(1)} k-links/s)`;
        }
    }
}

// Append the average routing speed (k-l/s) to the app name/version line,
// e.g. "Leniwiec 1.0007 (300k-l/s)"
function updateLogoWithSpeed() {
    const logoText = document.querySelector('.logo-text');
    if (!logoText) return;
    const base = logoText.textContent.split('(')[0].trim();
    const speeds = Object.values(routeSpeeds);
    if (speeds.length > 0) {
        const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        logoText.textContent = `${base} (${Math.round(avg)}k-l/s)`;
    } else {
        logoText.textContent = base;
    }
}

// Called by Android when download progress updates
window.onDownloadProgress = function(regionId, progress) {
    const el = document.getElementById('download-progress-bar');
    const textEl = document.getElementById('download-progress-text');
    if (el) el.style.width = (progress * 100) + '%';
    if (textEl) textEl.textContent = Math.round(progress * 100) + '%';
};

// Called by Android when download completes
window.onDownloadComplete = function(regionId) {
    const btn = document.querySelector(`.download-btn[data-region="${regionId}"]`);
    if (btn) {
        btn.textContent = '✓ Pobrano';
        btn.disabled = true;
    }
    hideLoader();
    const textEl = document.getElementById('download-progress-text');
    if (textEl) textEl.textContent = 'Gotowe!';
};

// Route colors (Emerald, Blue, Purple)
const routeColors = {
    selectedFlat: '#10b981',
    selectedAlt1: '#3b82f6',
    selectedAlt2: '#8b5cf6',
    unselected: '#475569'
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    lucide.createIcons();

    // Show build version next to app name (e.g. "Leniwiec 1.0001")
    try {
        const version = (window.AndroidInterface && window.AndroidInterface.getAppVersion)
            ? window.AndroidInterface.getAppVersion()
            : '1.0001';
        const logoText = document.querySelector('.logo-text');
        if (logoText) logoText.textContent = `Leniwiec ${version}`;
    } catch (e) { /* keep default app name */ }
    
    // Initialize Map
    initMap();
    
    // Set up Input Event Listeners
    setupSearchInput('start-input', 'start-suggestions');
    setupSearchInput('end-input', 'end-suggestions');
    
    // Plan Button
    document.getElementById('plan-btn').addEventListener('click', calculateRoutes);
    
    // GPS Button
    document.getElementById('use-gps-btn').addEventListener('click', useGPS);
    
    // Mode switcher tabs
    const abBtn = document.getElementById('mode-ab-btn');
    const loopBtn = document.getElementById('mode-loop-btn');
    const abOnlyElements = document.querySelectorAll('.mode-ab-only');
    const loopOnlyElements = document.querySelectorAll('.mode-loop-only');
    
    function updateRouteCountLabel() {
        const desc = document.getElementById('route-count-desc');
        const input = document.getElementById('route-count-input');
        if (currentMode === 'loop') {
            desc.textContent = 'kierunków pętli';
            if (parseInt(input.value) > 66) input.value = 66;
        } else {
            desc.textContent = 'alternatyw';
            if (parseInt(input.value) > 66) input.value = 66;
        }
    }
    
    abBtn.addEventListener('click', () => {
        currentMode = 'ab';
        abBtn.classList.add('active');
        loopBtn.classList.remove('active');
        abOnlyElements.forEach(el => el.classList.remove('hidden'));
        loopOnlyElements.forEach(el => el.classList.add('hidden'));
        if (endMarker) {
            endMarker.addTo(map);
        }
        // Hide the results panel so it doesn't cover the map when switching modes
        const resultsPanel = document.getElementById('results-panel');
        if (resultsPanel) resultsPanel.classList.add('hidden');
        updateRouteCountLabel();
    });
    
    loopBtn.addEventListener('click', () => {
        currentMode = 'loop';
        loopBtn.classList.add('active');
        abBtn.classList.remove('active');
        abOnlyElements.forEach(el => el.classList.add('hidden'));
        loopOnlyElements.forEach(el => el.classList.remove('hidden'));
        if (endMarker) {
            map.removeLayer(endMarker);
        }
        // Hide the results panel so it doesn't cover the map when switching modes
        const resultsPanel = document.getElementById('results-panel');
        if (resultsPanel) resultsPanel.classList.add('hidden');
        updateRouteCountLabel();
    });
    
    // Route count +/- buttons
    function adjustRouteCount(delta) {
        const input = document.getElementById('route-count-input');
        let val = parseInt(input.value) + delta;
        const min = parseInt(input.min);
        const max = parseInt(input.max);
        if (currentMode === 'ab' && val > 66) val = 66;
        if (val < min) val = min;
        if (val > max) val = max;
        input.value = val;
    }
    
    document.getElementById('route-count-minus').addEventListener('click', () => adjustRouteCount(-1));
    document.getElementById('route-count-plus').addEventListener('click', () => adjustRouteCount(1));
    
    // Initialize route count label
    updateRouteCountLabel();
    
    // Results Panel collapse/expand toggle
    const resultsHeader = document.getElementById('results-header');
    const resultsPanel = document.getElementById('results-panel');
    const collapseIcon = document.getElementById('collapse-icon');
    
    resultsHeader.addEventListener('click', () => {
        const searchPanel = document.querySelector('.search-panel');
        const showUiBtn = document.getElementById('show-ui-btn');
        if (resultsPanel) resultsPanel.classList.add('hidden');
        if (searchPanel) searchPanel.classList.add('hidden');
        if (showUiBtn) showUiBtn.classList.remove('hidden');
    });

    const showUiBtn = document.getElementById('show-ui-btn');
    if (showUiBtn) {
        showUiBtn.addEventListener('click', () => {
            const searchPanel = document.querySelector('.search-panel');
            if (resultsPanel) {
                resultsPanel.classList.remove('hidden', 'collapsed');
            }
            if (searchPanel) {
                searchPanel.classList.remove('hidden');
            }
            showUiBtn.classList.add('hidden');
            if (collapseIcon) collapseIcon.style.transform = 'rotate(0deg)';
        });
    }

    // Click on map to set points
    map.on('click', onMapClick);
});

// Init Leaflet Map
function initMap() {
    // Default focus: Warsaw, Poland
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([52.2297, 21.0122], 13);

    // Dark Matter map tiles (CartoDB)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);

    // Reposition zoom control to bottom right
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);
}

// Set active input tracking
document.getElementById('start-input').addEventListener('focus', () => { activeInput = 'start'; });
document.getElementById('end-input').addEventListener('focus', () => { activeInput = 'end'; });

// Set coordinates from geocoding or GPS
function setLocation(type, lat, lon, name) {
    const input = document.getElementById(`${type}-input`);
    input.value = name;
    
    if (type === 'start') {
        if (startMarker) map.removeLayer(startMarker);
        startMarker = L.marker([lat, lon], {
            draggable: true,
            icon: L.divIcon({
                className: 'custom-marker start-marker',
                html: '<div style="background-color: #3b82f6; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            })
        }).addTo(map);
        
        startMarker.on('dragend', () => {
            const pos = startMarker.getLatLng();
            reverseGeocode('start', pos.lat, pos.lng);
        });
    } else {
        if (endMarker) map.removeLayer(endMarker);
        endMarker = L.marker([lat, lon], {
            draggable: true,
            icon: L.divIcon({
                className: 'custom-marker end-marker',
                html: '<div style="background-color: #8b5cf6; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            })
        }).addTo(map);
        
        endMarker.on('dragend', () => {
            const pos = endMarker.getLatLng();
            reverseGeocode('end', pos.lat, pos.lng);
        });
    }

    // Pan to marker
    map.setView([lat, lon], Math.max(map.getZoom(), 13));
}

// Handle Map Click to set location
function onMapClick(e) {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    
    if (currentMode === 'loop') {
        reverseGeocode('start', lat, lon);
    } else {
        if (!startMarker || (activeInput === 'start')) {
            reverseGeocode('start', lat, lon);
            activeInput = 'end'; // Auto switch to next input
        } else if (!endMarker || (activeInput === 'end')) {
            reverseGeocode('end', lat, lon);
        }
    }
}

// GPS Location
function useGPS() {
    if (!navigator.geolocation) {
        alert("Geolokalizacja nie jest obsługiwana przez Twoje urządzenie.");
        return;
    }
    
    showLoader("Pobieranie lokalizacji GPS...");
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            reverseGeocode('start', lat, lon);
            hideLoader();
        },
        (error) => {
            hideLoader();
            alert("Nie można pobrać lokalizacji GPS. Upewnij się, że masz włączony dostęp do lokalizacji.");
            console.error(error);
        },
        { enableHighAccuracy: true }
    );
}

// Nominatim Geocoder Search
function setupSearchInput(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    let debounceTimer;

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value.trim();
        if (query.length < 3) {
            suggestions.classList.add('hidden');
            return;
        }

        debounceTimer = setTimeout(() => {
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=pl`)
                .then(res => res.json())
                .then(data => {
                    suggestions.innerHTML = '';
                    if (data.length === 0) {
                        suggestions.classList.add('hidden');
                        return;
                    }
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.textContent = item.display_name;
                        div.addEventListener('click', () => {
                            setLocation(inputId.split('-')[0], parseFloat(item.lat), parseFloat(item.lon), item.display_name);
                            suggestions.classList.add('hidden');
                        });
                        suggestions.appendChild(div);
                    });
                    suggestions.classList.remove('hidden');
                })
                .catch(err => console.error("Geocoding error:", err));
        }, 400);
    });

    // Close suggestions on click outside
    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== suggestions) {
            suggestions.classList.add('hidden');
        }
    });
}

// Reverse Geocoding
function reverseGeocode(type, lat, lon) {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
        .then(res => res.json())
        .then(data => {
            const name = data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            setLocation(type, lat, lon, name);
        })
        .catch(err => {
            setLocation(type, lat, lon, `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
            console.error("Reverse geocoding error:", err);
        });
}

// ── Local route fetching via Android native interface (async callback pattern) ──
async function fetchRouteLocal(lonlats, profile, idx, nogoLonLats = '', timeoutMs = 15000) {
    // After a route finishes, check if all are done and show average speed
    if (Object.keys(activeRoutingProgress).length === 0) {
        // All routes finished – compute average speed
        const speeds = Object.values(routeSpeeds);
        if (speeds.length > 0) {
            const avg = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1);
            const summaryEl = document.getElementById('average-speed-summary');
            if (summaryEl) {
                summaryEl.textContent = `Średnia prędkość: ${avg} k‑links/s`;
            } else {
                const el = document.createElement('div');
                el.id = 'average-speed-summary';
                el.style.marginTop = '8px';
                el.style.fontWeight = '500';
                el.textContent = `Średnia prędkość: ${avg} k‑links/s`;
                const container = document.getElementById('results-panel');
                if (container) container.appendChild(el);
            }
        }
    }
    // Check if native local routing is available
    if (window.AndroidInterface && window.AndroidInterface.isLocalRoutingAvailable && window.AndroidInterface.isLocalRoutingAvailable()) {
        try {
            return await new Promise((resolve, reject) => {
                const callbackId = ++routingCallbackId;
                routingCallbacks[callbackId] = { resolve, reject };
                activeRoutingProgress[callbackId] = { linksProcessed: 0, elapsedMs: 0 };
                window.AndroidInterface.calculateRouteAsync(lonlats, profile || 'trekking', idx, nogoLonLats, callbackId);
                // Timeout per route (default 15s, scaled up for longer loops)
                setTimeout(() => {
                    if (routingCallbacks[callbackId]) {
                        delete routingCallbacks[callbackId];
                        delete activeRoutingProgress[callbackId];
                        reject(new Error("Local routing timeout"));
                    }
                }, timeoutMs);
            });
        } catch (err) {
            console.warn("Local routing failed/timeout. Falling back to online BRouter API.", err);
        }
    }
    // Fallback: online BRouter API
    const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile || 'trekking'}&alternativeidx=${idx}&format=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Błąd pobierania trasy");
    return res.json();
}

// Local round-trip (loop) via BRouter's round-trip engine mode
async function fetchRoundTripLocal(startLat, startLng, radiusMeters, startDirection, points = 5, timeoutMs = 30000) {
    if (window.AndroidInterface && window.AndroidInterface.calculateRoundTripAsync && window.AndroidInterface.isLocalRoutingAvailable()) {
        try {
            return await new Promise((resolve, reject) => {
                const callbackId = ++routingCallbackId;
                routingCallbacks[callbackId] = { resolve, reject };
                activeRoutingProgress[callbackId] = { linksProcessed: 0, elapsedMs: 0 };
                window.AndroidInterface.calculateRoundTripAsync(startLat, startLng, radiusMeters, startDirection, points, callbackId);
                // Round-trip includes terrain analysis; timeout scales with route length
                setTimeout(() => {
                    if (routingCallbacks[callbackId]) {
                        delete routingCallbacks[callbackId];
                        delete activeRoutingProgress[callbackId];
                        reject(new Error("Round-trip routing timeout"));
                    }
                }, timeoutMs);
            });
        } catch (err) {
            console.warn("Round-trip routing failed/timeout.", err);
        }
    }
    return null;
}

// ── Loop via 4 waypoints (Simple Single Request) ──
// Forces a loop using 5 waypoints (Start → P1 → Cel → P2 → Start) on a square.
// Calculates everything in one fast BRouter call.
// BRouter round-trip distance is the loop RADIUS; the resulting loop length is
// roughly 5x the radius. Tunable to match the requested total loop distance.
const ROUND_TRIP_RADIUS_FACTOR = 5;

// Time budget for loop routing, scaled by the requested route length:
// 30s per 10km of loop (min 20s) for a single variant; the whole series gets
// perRoute * routeCount + 10s, capped at 6 minutes, so the UI always finishes.
function loopTimeoutForDistance(distanceKm) {
    const perRouteSec = Math.max(20, Math.ceil(distanceKm / 10) * 30);
    return perRouteSec * 1000;
}
const LOOP_SERIES_MAX_MS = 360000;

async function calculateLoopRoute(start, angleDeg, distanceVal, timeoutMs = undefined) {
    const distanceMeters = distanceVal * 1000;
    const radiusMeters = Math.max(500, Math.round(distanceMeters / ROUND_TRIP_RADIUS_FACTOR));

    // BRouter generates soft waypoints on a circle around start and snaps them
    // within waypointCatchingRange, following flat infrastructure nearby.
    let result = await fetchRoundTripLocal(start.lat, start.lng, radiusMeters, angleDeg, 5, timeoutMs);

    // Fallback to the legacy fixed-via loop if round-trip fails.
    if (!result || !result.features || result.features.length === 0) {
        const points = RouteGeo.calculateViaPoints(
            start.lat, start.lng,
            angleDeg,
            distanceMeters,
            0.20
        );

        const lonlats = [
            `${start.lng},${start.lat}`,
            `${points.p1.lng.toFixed(6)},${points.p1.lat.toFixed(6)}`,
            `${points.cel.lng.toFixed(6)},${points.cel.lat.toFixed(6)}`,
            `${points.p2.lng.toFixed(6)},${points.p2.lat.toFixed(6)}`,
            `${start.lng},${start.lat}`
        ].join('|');

        result = await fetchRouteLocal(lonlats, 'trekking', 0, '', timeoutMs);
    }

    if (!result || !result.features || result.features.length === 0) {
        throw new Error('Nie udało się wyznaczyć trasy pętli');
    }

    // Remove any backtracking branches, preserving the first/last 500m
    result.features[0].geometry.coordinates = RouteGeo.removeBacktracking(
        result.features[0].geometry.coordinates,
        { proximityMeters: 5, skipEndsMeters: 500, minIndexGap: 10 }
    );

    return result;
}

// ── Faza 2: scoring of generated route candidates (lower = better) ──
// Score = w1*DistanceDiff + w2*TotalAscent + w3*OverlapPenalty (all in meters)
const SCORE_WEIGHTS = { distance: 1, ascent: 2, overlap: 1 };

function computeRouteScore(route, targetDistanceMeters) {
    const distanceDiff = targetDistanceMeters > 0
        ? Math.abs(route.distanceMeters - targetDistanceMeters)
        : 0;
    const totalAscent = route.elevationGain || 0;
    const overlap = route.overlapMeters || 0;
    return SCORE_WEIGHTS.distance * distanceDiff
         + SCORE_WEIGHTS.ascent * totalAscent
         + SCORE_WEIGHTS.overlap * overlap;
}

// ── Route metrics (distance / elevation / overlap) computed from GeoJSON ──
function computeRouteMetrics(geojson) {
    const feature = geojson.features[0];
    const coordinates = feature.geometry.coordinates; // [[lon, lat, elev], ...]

    // Calculate distance from coordinates (ignores track-length property,
    // which may be stale after calculateLoopRoute trims backtracking branches)
    let distanceMeters = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
        const p1 = L.latLng(coordinates[i][1], coordinates[i][0]);
        const p2 = L.latLng(coordinates[i + 1][1], coordinates[i + 1][0]);
        distanceMeters += p1.distanceTo(p2);
    }

    // Calculate elevation gain/loss
    let elevationGain = 0;
    let elevationLoss = 0;
    const elevations = [];
    const distances = [];
    let currentDist = 0;

    for (let i = 0; i < coordinates.length; i++) {
        const elev = coordinates[i][2] || 0;
        elevations.push(elev);

        if (i > 0) {
            const p1 = L.latLng(coordinates[i - 1][1], coordinates[i - 1][0]);
            const p2 = L.latLng(coordinates[i][1], coordinates[i][0]);
            const dist = p1.distanceTo(p2);
            currentDist += dist;

            const diff = elev - coordinates[i - 1][2];
            if (diff > 0) {
                elevationGain += diff;
            } else {
                elevationLoss += Math.abs(diff);
            }
        }
        distances.push(currentDist / 1000); // km
    }

    const overlap = RouteGeo.findRouteOverlap(coordinates);

    return {
        coordinates,
        distanceMeters: Math.round(distanceMeters),
        distanceKm: (distanceMeters / 1000).toFixed(1),
        elevationGain: Math.round(elevationGain),
        elevationLoss: Math.round(elevationLoss),
        overlapMeters: overlap.overlapMeters || 0,
        overlapRatio: overlap.overlapRatio || 0,
        timeMinutes: Math.round((distanceMeters / 1000) / 15 * 60), // Assumes 15km/h average bike speed
        elevations,
        distances
    };
}

// ── Route acceptance criteria ──
// Candidates that fail these are rejected and the search is repeated until the
// requested number of variants is reached (or the search budget runs out).
const DEFAULT_ROUTE_CRITERIA = {
    ascentPerKm: 15,        // max ~15 m of elevation gain per route km
    overlapRatio: 0.10,     // max 10% of route length overlapping itself
    distanceTolerance: 0.40 // loop: target distance ±40%
};

// Runtime criteria — values may be overridden from the settings modal (localStorage).
const ROUTE_CRITERIA = {
    ascentPerKm: DEFAULT_ROUTE_CRITERIA.ascentPerKm,
    overlapRatio: DEFAULT_ROUTE_CRITERIA.overlapRatio,
    distanceTolerance: DEFAULT_ROUTE_CRITERIA.distanceTolerance
};
const MAX_ALTERNATIVES = 10; // max BRouter alternative index to try for A→B mode

function routeMeetsCriteria(metrics, targetDistanceMeters) {
    const km = metrics.distanceMeters / 1000;
    if (metrics.elevationGain > ROUTE_CRITERIA.ascentPerKm * km) return false;
    if (metrics.overlapRatio > ROUTE_CRITERIA.overlapRatio) return false;
    if (targetDistanceMeters > 0) {
        const diff = Math.abs(metrics.distanceMeters - targetDistanceMeters);
        if (diff > ROUTE_CRITERIA.distanceTolerance * targetDistanceMeters) return false;
    }
    return true;
}

async function calculateRoutes() {
    if (currentMode === 'ab') {
        if (!startMarker || !endMarker) {
            alert("Wybierz punkt startowy A oraz cel B.");
            return;
        }
    } else {
        if (!startMarker) {
            alert("Wybierz punkt startowy A na mapie.");
            return;
        }
    }

    showLoader("Obliczanie optymalnych tras rowerowych...");
    
    // Clear old lines
    mapRoutes.forEach(r => map.removeLayer(r));
    mapRoutes = [];
    routesData = [];
    routeSpeeds = {}; // reset speeds before a new calculation

    let results = [];
    let rejectedPool = [];
    let targetDistanceMeters = 0;
    const routeCount = parseInt(document.getElementById('route-count-input').value) || 3;

    try {
        if (currentMode === 'ab') {
            const start = startMarker.getLatLng();
            const end = endMarker.getLatLng();
            const lonlats = `${start.lng},${start.lat}|${end.lng},${end.lat}`;

            let completed = 0;
            let alternativeIdx = 0;
            const allResults = [];
            // Keep requesting further BRouter alternatives until we have the
            // requested number of variants that pass the criteria (or run out).
            while (allResults.length < routeCount && alternativeIdx < MAX_ALTERNATIVES) {
                const needed = routeCount - allResults.length;
                const indices = [];
                while (indices.length < needed && alternativeIdx < MAX_ALTERNATIVES) {
                    indices.push(alternativeIdx);
                    alternativeIdx++;
                }
                const batch = await Promise.all(indices.map(idx => {
                    return fetchRouteLocal(lonlats, 'trekking', idx)
                        .then(geojson => {
                            completed++;
                            showLoader(`Obliczanie wariantu ${Math.min(completed, routeCount)} z ${routeCount}...`);
                            return { index: idx, geojson: geojson };
                        })
                        .catch(err => {
                            completed++;
                            showLoader(`Obliczanie wariantu ${Math.min(completed, routeCount)} z ${routeCount}...`);
                            console.warn(`Alternative ${idx} failed or not available`, err);
                            return null;
                        });
                }));
                for (const r of batch) {
                    if (r !== null && r.geojson && r.geojson.features && r.geojson.features.length > 0) {
                        const metrics = computeRouteMetrics(r.geojson);
                        if (routeMeetsCriteria(metrics, 0)) {
                            allResults.push({ index: allResults.length, geojson: r.geojson, metrics });
                        } else {
                            rejectedPool.push({ geojson: r.geojson, metrics });
                            console.warn(`Alternative ${r.index} rejected (criteria not met)`, metrics);
                        }
                    }
                }
            }
            results = allResults;
        } else {
            const start = startMarker.getLatLng();
            const distanceVal = parseFloat(document.getElementById('loop-distance-input').value) || 10;
            targetDistanceMeters = distanceVal * 1000;

            const triedAngles = new Set();
            let angleOffset = 0;
            let completed = 0;
            const perRouteTimeoutMs = loopTimeoutForDistance(distanceVal);
            const seriesTimeoutMs = Math.min(perRouteTimeoutMs * routeCount + 10000, LOOP_SERIES_MAX_MS);
            const loopDeadline = Date.now() + seriesTimeoutMs;
            let seriesActive = true;

            while (results.length < routeCount && triedAngles.size < 36 && Date.now() < loopDeadline) {
                const needed = routeCount - results.length;
                const step = 360 / routeCount;
                const newAngles = [];
                
                for (let i = 0; i < routeCount; i++) {
                    const angle = (i * step + angleOffset) % 360;
                    if (!triedAngles.has(angle)) {
                        newAngles.push(angle);
                    }
                }

                if (newAngles.length === 0) {
                    angleOffset = (angleOffset + 15) % 360;
                    continue;
                }

                const anglesToTry = newAngles.slice(0, needed);
                anglesToTry.forEach(a => triedAngles.add(a));

                showLoader(`Obliczanie wariantu ${completed} z ${routeCount}...`);

                const batchPromises = anglesToTry.map((angle) => {
                    return calculateLoopRoute(start, angle, distanceVal, perRouteTimeoutMs)
                        .then(geojson => {
                            if (!seriesActive) return null;
                            completed++;
                            showLoader(`Obliczanie wariantu ${Math.min(completed, routeCount)} z ${routeCount}...`);
                            return { geojson, angle };
                        })
                        .catch(err => {
                            if (!seriesActive) return null;
                            completed++;
                            showLoader(`Obliczanie wariantu ${Math.min(completed, routeCount)} z ${routeCount}...`);
                            console.warn(`Loop candidate at angle ${angle} failed`, err);
                            return null;
                        });
                });

                // Hard cap: never let a batch exceed the remaining series budget.
                const remainingMs = Math.max(0, loopDeadline - Date.now());
                const batchResults = await Promise.race([
                    Promise.all(batchPromises),
                    new Promise(resolve => setTimeout(() => resolve(null), remainingMs))
                ]);

                if (batchResults === null) {
                    // Series time budget exhausted — stop and keep what we have.
                    seriesActive = false;
                    break;
                }
                
                for (const r of batchResults) {
                    if (r !== null && r.geojson && r.geojson.features && r.geojson.features.length > 0) {
                        const metrics = computeRouteMetrics(r.geojson);
                        // Reject candidates that fail the criteria and keep searching
                        // until the requested number of variants is reached.
                        if (routeMeetsCriteria(metrics, targetDistanceMeters)) {
                            results.push({
                                index: results.length,
                                angle: r.angle,
                                geojson: r.geojson,
                                metrics
                            });
                        } else {
                            rejectedPool.push({ angle: r.angle, geojson: r.geojson, metrics });
                            console.warn("Loop candidate rejected (criteria not met)", metrics);
                        }
                    }
                }

                if (Date.now() >= loopDeadline) {
                    seriesActive = false;
                    break;
                }

                if (results.length < routeCount) {
                    angleOffset = (angleOffset + 15) % 360;
                }
            }
        }

        // If every candidate was rejected by the criteria, fall back to the
        // closest candidates so the user still gets usable results (e.g. in
        // hilly terrain where nothing is flat enough).
        if (results.length === 0 && rejectedPool.length > 0) {
            rejectedPool.forEach(r => { r.score = computeRouteScore(r.metrics, targetDistanceMeters); });
            rejectedPool.sort((a, b) => a.score - b.score);
            results = rejectedPool.slice(0, routeCount).map((r, i) => ({ ...r, index: i }));
        }

        hideLoader();
        updateLogoWithSpeed();

        // Filter out failed routes
        const validResults = results.filter(r => r !== null && r.geojson && r.geojson.features && r.geojson.features.length > 0);

            if (validResults.length === 0) {
                alert("Nie znaleziono tras dla wybranych punktów. Spróbuj zmienić lokalizację.");
                return;
            }

            // Process route metrics (reuse metrics already computed for the criteria checks)
            routesData = validResults.map(res => {
                const m = res.metrics || computeRouteMetrics(res.geojson);
                return {
                    index: res.index,
                    coordinates: m.coordinates,
                    distanceMeters: m.distanceMeters,
                    distanceKm: m.distanceKm,
                    elevationGain: m.elevationGain,
                    elevationLoss: m.elevationLoss,
                    overlapMeters: m.overlapMeters,
                    timeMinutes: m.timeMinutes,
                    elevations: m.elevations,
                    distances: m.distances
                };
            });

        // Faza 2: score candidates (distance diff + ascent + overlap) and sort ascending
        routesData.forEach(r => { r.score = computeRouteScore(r, targetDistanceMeters); });
        routesData.sort((a, b) => a.score - b.score);

        // Identify the one with minimum elevation gain
        let flatestIdx = 0;
        let minGain = Infinity;
        routesData.forEach((route, idx) => {
            if (route.elevationGain < minGain) {
                minGain = route.elevationGain;
                flatestIdx = idx;
            }
        });

        // The flattest route is the app's primary result — always list it FIRST,
        // no matter where the combined score would place it. The remaining
        // candidates keep their score-based order.
        if (flatestIdx > 0) {
            const [flattest] = routesData.splice(flatestIdx, 1);
            routesData.unshift(flattest);
            flatestIdx = 0;
        }

        routesData.forEach((route, idx) => {
            route.isFlatest = (idx === flatestIdx);
        });

        // Display results
        displayRoutes();
        selectRoute(0); // Select the first returned route by default

        // Show panel and reset collapse state
        const panel = document.getElementById('results-panel');
        panel.classList.remove('hidden', 'collapsed');
        document.getElementById('collapse-icon').style.transform = 'rotate(0deg)';
        const searchPanel = document.querySelector('.search-panel');
        if (searchPanel) searchPanel.classList.remove('hidden');
        const showUiBtn = document.getElementById('show-ui-btn');
        if (showUiBtn) showUiBtn.classList.add('hidden');

    } catch (error) {
        hideLoader();
        alert("Błąd podczas kalkulacji: " + error.message + " | " + error.toString() + "\n" + (error.stack || ""));
        console.error(error);
    }
}

// Display routes on map and insert route cards
function displayRoutes() {
    const container = document.getElementById('routes-container');
    container.innerHTML = '';

    // Clear previous Map polylines
    mapRoutes.forEach(r => map.removeLayer(r));
    mapRoutes = [];

    const bounds = L.latLngBounds();

    routesData.forEach((route, idx) => {
        // Draw polyline
        const latlngs = route.coordinates.map(c => [c[1], c[0]]);
        const polyline = L.polyline(latlngs, {
            color: routeColors.unselected,
            weight: 2,
            opacity: 0.2,
            lineJoin: 'round'
        }).addTo(map);
        
        polyline.on('click', () => selectRoute(idx));
        mapRoutes.push(polyline);

        // Extend bounds
        bounds.extend(polyline.getBounds());

        // Create Card
        const card = document.createElement('div');
        card.className = `route-card`;
        card.id = `route-card-${idx}`;
        
        // Custom name and badge
        let routeName = `Trasa ${idx + 1}`;
        if (currentMode === 'loop') {
            const compassLabels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW"];
            const routeCount = parseInt(document.getElementById('route-count-input').value) || 8;
            const step = 360 / routeCount;
            const angle = route.angle ?? (route.index * step);
            // Find closest compass label
            const labelIdx = Math.round(angle / 22.5) % 16;
            const label = compassLabels[labelIdx] || `${Math.round(angle)}°`;
            routeName = `Pętla ${label} (${Math.round(angle)}°)`;
        }
        
        let badgeHtml = '';
        if (route.isFlatest) {
            badgeHtml = '<span class="badge badge-flatest"><i data-lucide="sparkles" style="display:inline-block; width:10px; height:10px; margin-right:4px;"></i>Najbardziej płaska</span>';
        } else {
            const altLabel = currentMode === 'loop' ? 'Alternatywna' : 'Alternatywna ' + idx;
            badgeHtml = '<span class="badge badge-alt">' + altLabel + '</span>';
        }

        card.innerHTML = `
            <div class="route-header">
                <span class="route-name">${routeName}</span>
                ${badgeHtml}
            </div>
            <div class="route-metrics">
                <div class="metric-item highlight">
                    <i data-lucide="navigation-2"></i>
                    <span>${route.distanceKm} km</span>
                </div>
                <div class="metric-item highlight">
                    <i data-lucide="clock"></i>
                    <span>${route.timeMinutes} min</span>
                </div>
                <div class="metric-item highlight ${route.isFlatest ? 'flat-highlight' : 'elevation-gain'}">
                    <i data-lucide="trending-up"></i>
                    <span>+${route.elevationGain}m</span>
                </div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                <button class="gpx-share-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 10px; font-size: 11px; color: var(--text-primary); cursor: pointer; display: flex; align-items: center; gap: 4px; transition: background 0.2s;">
                    <i data-lucide="share-2" style="width: 12px; height: 12px;"></i> Udostępnij
                </button>
                <button class="gpx-save-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 10px; font-size: 11px; color: var(--text-primary); cursor: pointer; display: flex; align-items: center; gap: 4px; transition: background 0.2s;">
                    <i data-lucide="download" style="width: 12px; height: 12px;"></i> Zapisz
                </button>
            </div>
        `;

        card.addEventListener('click', () => selectRoute(idx));
        card.querySelector('.gpx-share-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            exportRouteGPX(route, routeName, 'share');
        });
        card.querySelector('.gpx-save-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            exportRouteGPX(route, routeName, 'save');
        });
        container.appendChild(card);
    });

    lucide.createIcons(); // Initialize newly added icons
    map.fitBounds(bounds.pad(0.05));
}

// Select a route and update graph + styles
function selectRoute(index) {
    // Style route cards
    routesData.forEach((route, idx) => {
        const card = document.getElementById(`route-card-${idx}`);
        card.classList.remove('selected', 'alt-1', 'alt-2');
        
        // Reset polyline style
        mapRoutes[idx].setStyle({
            color: routeColors.unselected,
            weight: 2,
            opacity: 0.2,
            zIndex: 1
        });
    });

    const selectedCard = document.getElementById(`route-card-${index}`);
    const selectedRoute = routesData[index];
    
    // Choose active theme color for selected route
    let activeColor = routeColors.selectedFlat;
    if (!selectedRoute.isFlatest) {
        if (index === 1) {
            selectedCard.classList.add('selected', 'alt-1');
            activeColor = routeColors.selectedAlt1;
        } else {
            selectedCard.classList.add('selected', 'alt-2');
            activeColor = routeColors.selectedAlt2;
        }
    } else {
        selectedCard.classList.add('selected');
    }

    // Bring selected polyline to front
    mapRoutes[index].setStyle({
        color: activeColor,
        weight: 7,
        opacity: 0.95,
        zIndex: 100
    });
    mapRoutes[index].bringToFront();

    // Update Elevation Graph
    updateElevationChart(selectedRoute, activeColor);
}

// Update the Elevation Chart.js instance
function updateElevationChart(route, color) {
    const ctx = document.getElementById('elevation-chart').getContext('2d');
    
    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 120);
    gradient.addColorStop(0, hexToRgba(color, 0.4));
    gradient.addColorStop(1, hexToRgba(color, 0.01));

    if (elevationChart) {
        elevationChart.destroy();
    }

    document.getElementById('elevation-summary').textContent = `Min: ${Math.min(...route.elevations)}m | Max: ${Math.max(...route.elevations)}m | Podjazdy: +${route.elevationGain}m`;

    elevationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: route.distances,
            datasets: [{
                data: route.elevations,
                borderColor: color,
                borderWidth: 2,
                fill: true,
                backgroundColor: gradient,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: color,
                pointHoverBorderColor: '#ffffff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: (tooltipItems) => `Dystans: ${parseFloat(tooltipItems[0].label).toFixed(2)} km`,
                        label: (tooltipItem) => `Wysokość: ${Math.round(tooltipItem.raw)} m n.p.m.`
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    grid: { display: false },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 10, family: 'Plus Jakarta Sans' },
                        callback: (value) => `${value.toFixed(1)} km`
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 10, family: 'Plus Jakarta Sans' },
                        callback: (value) => `${value}m`
                    }
                }
            },
            onHover: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const coord = route.coordinates[index]; // [lon, lat, elev]
                    
                    if (coord) {
                        const latlng = [coord[1], coord[0]];
                        
                        if (hoverMarker) {
                            hoverMarker.setLatLng(latlng);
                        } else {
                            hoverMarker = L.circleMarker(latlng, {
                                radius: 7,
                                fillColor: color,
                                fillOpacity: 0.9,
                                color: '#ffffff',
                                weight: 2
                            }).addTo(map);
                        }
                    }
                } else if (hoverMarker) {
                    map.removeLayer(hoverMarker);
                    hoverMarker = null;
                }
            }
        }
    });
}

// Utility Helpers
function showLoader(text) {
    const loader = document.getElementById('loader');
    const textEl = loader.querySelector('.loader-text');
    // Preserve the already-appended speed suffix ("(x.x k-links/s)") if present
    const speedPart = (textEl.textContent.match(/\(\d+(\.\d+)? k-links\/s\)/) || [''])[0];
    textEl.textContent = speedPart ? `${text} ${speedPart}` : text;
    loader.classList.remove('hidden');
}

function hideLoader() {
    document.getElementById('loader').classList.add('hidden');
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Export selected route to GPX
function exportRouteGPX(route, routeName, action = 'share') {
    try {
        const coordinates = route.coordinates; // Array of [lon, lat, ele] from geojson
        if (!coordinates || coordinates.length === 0) {
            alert("Brak danych współrzędnych dla tej trasy.");
            return;
        }

        let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Leniwiec" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${routeName}</name>
    <desc>Trasa wygenerowana przez aplikację Leniwiec o minimalnym stopniu nachylenia.</desc>
  </metadata>
  <trk>
    <name>${routeName}</name>
    <trkseg>`;

        coordinates.forEach(pt => {
            const lon = pt[0];
            const lat = pt[1];
            const ele = pt[2] !== undefined ? pt[2] : 0;
            gpx += `\n      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
        });

        gpx += `\n    </trkseg>
  </trk>
</gpx>`;

        const safeFileName = routeName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".gpx";

        if (action === 'save' && window.AndroidInterface && window.AndroidInterface.saveGPX) {
            window.AndroidInterface.saveGPX(safeFileName, gpx);
        } else if (action === 'share' && window.AndroidInterface && window.AndroidInterface.shareGPX) {
            window.AndroidInterface.shareGPX(safeFileName, gpx);
        } else {
            // Fallback for desktop browser testing
            const blob = new Blob([gpx], { type: "application/gpx+xml" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = safeFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        alert("Błąd generowania pliku GPX: " + err.message);
    }
}

// ── Data Management Modal ──

document.addEventListener('DOMContentLoaded', () => {
    // Data management button
    const dataManageBtn = document.getElementById('data-manage-btn');
    const dataModal = document.getElementById('data-modal');
    const dataModalClose = document.getElementById('data-modal-close');
    const regionsList = document.getElementById('regions-list');
    const deleteAllBtn = document.getElementById('delete-all-data-btn');
    const progressContainer = document.getElementById('download-progress-container');
    const dataStatusText = document.getElementById('data-status-text');

    // Open modal
    dataManageBtn.addEventListener('click', () => {
        dataModal.classList.remove('hidden');
        refreshRegionsList();
    });

    // Close modal
    dataModalClose.addEventListener('click', () => {
        dataModal.classList.add('hidden');
    });

    // Close modal on overlay click
    dataModal.addEventListener('click', (e) => {
        if (e.target === dataModal) {
            dataModal.classList.add('hidden');
        }
    });

    // Delete all data
    deleteAllBtn.addEventListener('click', () => {
        if (confirm('Usunąć wszystkie pobrane dane routingu?')) {
            if (window.AndroidInterface && window.AndroidInterface.deleteAllData) {
                window.AndroidInterface.deleteAllData();
            }
            deleteAllBtn.classList.add('hidden');
            refreshRegionsList();
        }
    });

    function refreshRegionsList() {
        // Show loading
        dataStatusText.textContent = 'Sprawdzanie pobranych danych...';
        
        if (!window.AndroidInterface || !window.AndroidInterface.getRegionsStatus) {
            // Not running on Android or interface not available
            regionsList.innerHTML = '<p style="color: var(--text-secondary); font-size: 13px;">Tryb offline dostępny tylko na urządzeniu z Androidem.</p>';
            dataStatusText.textContent = '';
            return;
        }

        // Get regions status from native
        const regionsJson = window.AndroidInterface.getRegionsStatus();
        const regions = JSON.parse(regionsJson);
        const downloadedSegments = window.AndroidInterface.getDownloadedSegments
            ? JSON.parse(window.AndroidInterface.getDownloadedSegments())
            : [];
        const totalSize = window.AndroidInterface.getDownloadedDataSize
            ? window.AndroidInterface.getDownloadedDataSize()
            : 0;

        // Build region items
        regionsList.innerHTML = '';
        let hasData = false;

        regions.forEach(region => {
            const item = document.createElement('div');
            item.className = 'region-item';

            const info = document.createElement('div');
            info.className = 'region-info';

            const name = document.createElement('span');
            name.className = 'region-name';
            name.textContent = region.displayName;
            info.appendChild(name);

            const status = document.createElement('span');
            status.className = 'region-status';
            if (region.isFullyDownloaded) {
                status.textContent = '✓ Pobrano';
                status.style.color = 'var(--accent-emerald-light)';
                hasData = true;
            } else if (region.downloadedTiles > 0) {
                status.textContent = `Pobrano ${region.downloadedTiles}/${region.totalTiles}`;
            } else {
                status.textContent = `Do pobrania: ${region.totalTiles} plików`;
            }
            info.appendChild(status);

            item.appendChild(info);

            const btn = document.createElement('button');
            btn.className = 'download-btn';
            btn.dataset.region = region.id;
            if (region.isFullyDownloaded) {
                btn.textContent = '✓ Pobrano';
                btn.disabled = true;
            } else {
                btn.textContent = 'Pobierz';
                btn.addEventListener('click', () => {
                    btn.disabled = true;
                    btn.textContent = 'Pobieranie...';
                    progressContainer.classList.remove('hidden');
                    document.getElementById('download-progress-bar').style.width = '0%';
                    document.getElementById('download-progress-text').textContent = '0%';
                    window.AndroidInterface.downloadRegion(region.id);
                });
            }
            item.appendChild(btn);

            regionsList.appendChild(item);
        });

        // Update status text
        if (downloadedSegments.length > 0) {
            const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
            dataStatusText.textContent = `Pobrano ${downloadedSegments.length} plików (${sizeMB} MB)`;
            deleteAllBtn.classList.remove('hidden');
        } else {
            dataStatusText.textContent = 'Brak pobranych danych. Wybierz region i kliknij "Pobierz".';
            deleteAllBtn.classList.add('hidden');
            progressContainer.classList.add('hidden');
        }
    }
});

// ── Route Criteria Settings Modal ──

document.addEventListener('DOMContentLoaded', () => {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const settingsModalClose = document.getElementById('settings-modal-close');
    const settingsResetBtn = document.getElementById('settings-reset-btn');

    const SETTINGS_STORAGE_KEY = 'leniwiec_route_criteria';

    // Field descriptors: internal key -> DOM ids + display mapping.
    // overlapRatio and distanceTolerance are stored as ratios (0..1) but
    // shown/edited as percentages in the UI.
    const SETTINGS_FIELDS = [
        { key: 'ascentPerKm',       rangeId: 'crit-ascent-range',       numberId: 'crit-ascent',       min: 0, max: 100, step: 1 },
        { key: 'overlapRatio',      rangeId: 'crit-overlap-range',      numberId: 'crit-overlap',      min: 0, max: 50,  step: 1, toDisplay: v => Math.round(v * 100), fromDisplay: v => v / 100 },
        { key: 'distanceTolerance', rangeId: 'crit-tolerance-range',    numberId: 'crit-tolerance',    min: 0, max: 100, step: 5, toDisplay: v => Math.round(v * 100), fromDisplay: v => v / 100 }
    ];

    function loadRouteCriteriaSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            for (const field of SETTINGS_FIELDS) {
                const value = Number(saved[field.key]);
                if (Number.isFinite(value)) {
                    ROUTE_CRITERIA[field.key] = value;
                }
            }
        } catch (err) {
            console.warn('Nie udało się wczytać ustawień tras:', err);
        }
    }

    function saveRouteCriteriaSettings() {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
                ascentPerKm: ROUTE_CRITERIA.ascentPerKm,
                overlapRatio: ROUTE_CRITERIA.overlapRatio,
                distanceTolerance: ROUTE_CRITERIA.distanceTolerance
            }));
        } catch (err) {
            console.warn('Nie udało się zapisać ustawień tras:', err);
        }
    }

    function displayValue(field) {
        return field.toDisplay ? field.toDisplay(ROUTE_CRITERIA[field.key]) : ROUTE_CRITERIA[field.key];
    }

    // Apply a display value to ROUTE_CRITERIA and sync both controls + persist.
    function applyValue(field, displayVal) {
        const raw = field.fromDisplay ? field.fromDisplay(displayVal) : displayVal;
        ROUTE_CRITERIA[field.key] = raw;
        const range = document.getElementById(field.rangeId);
        const number = document.getElementById(field.numberId);
        if (range) range.value = displayVal;
        if (number) number.value = displayVal;
        saveRouteCriteriaSettings();
    }

    // Load saved values and sync the controls
    loadRouteCriteriaSettings();
    for (const field of SETTINGS_FIELDS) {
        applyValue(field, displayValue(field));
    }

    // Open modal
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
        // Re-sync controls from ROUTE_CRITERIA in case values changed elsewhere
        for (const field of SETTINGS_FIELDS) {
            applyValue(field, displayValue(field));
        }
    });

    // Close modal
    settingsModalClose.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    // Close modal on overlay click
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });

    // Reset to defaults
    settingsResetBtn.addEventListener('click', () => {
        for (const field of SETTINGS_FIELDS) {
            ROUTE_CRITERIA[field.key] = DEFAULT_ROUTE_CRITERIA[field.key];
        }
        for (const field of SETTINGS_FIELDS) {
            applyValue(field, displayValue(field));
        }
    });

    // Slider / number input listeners (two-way sync)
    for (const field of SETTINGS_FIELDS) {
        const range = document.getElementById(field.rangeId);
        const number = document.getElementById(field.numberId);
        if (!range || !number) continue;

        range.addEventListener('input', () => {
            number.value = range.value;
            applyValue(field, parseFloat(range.value));
        });

        number.addEventListener('input', () => {
            let val = parseFloat(number.value);
            if (Number.isNaN(val)) return;
            val = Math.max(field.min, Math.min(field.max, val));
            number.value = val;
            range.value = val;
            applyValue(field, val);
        });
    }
});
