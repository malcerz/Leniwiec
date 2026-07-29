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
    
    abBtn.addEventListener('click', () => {
        currentMode = 'ab';
        abBtn.classList.add('active');
        loopBtn.classList.remove('active');
        abOnlyElements.forEach(el => el.classList.remove('hidden'));
        loopOnlyElements.forEach(el => el.classList.add('hidden'));
        if (endMarker) {
            endMarker.addTo(map);
        }
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
    });
    
    // Results Panel collapse/expand toggle
    const resultsHeader = document.getElementById('results-header');
    const resultsPanel = document.getElementById('results-panel');
    const collapseIcon = document.getElementById('collapse-icon');
    
    resultsHeader.addEventListener('click', () => {
        const isCollapsed = resultsPanel.classList.toggle('collapsed');
        if (isCollapsed) {
            collapseIcon.style.transform = 'rotate(180deg)';
        } else {
            collapseIcon.style.transform = 'rotate(0deg)';
        }
    });

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

// Route Calculation & Comparison
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

    let fetchPromises = [];

    if (currentMode === 'ab') {
        const start = startMarker.getLatLng();
        const end = endMarker.getLatLng();
        const lonlats = `${start.lng},${start.lat}|${end.lng},${end.lat}`;

        // Fetch 3 alternatives (0, 1, 2) parallelly
        fetchPromises = [0, 1, 2].map(idx => {
            const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=trekking&alternativeidx=${idx}&format=geojson`;
            return fetch(url)
                .then(res => {
                    if (!res.ok) throw new Error("Błąd pobierania trasy");
                    return res.json();
                })
                .then(geojson => {
                    return { index: idx, geojson: geojson };
                })
                .catch(err => {
                    console.warn(`Alternative ${idx} failed or not available`, err);
                    return null;
                });
        });
    } else {
        const start = startMarker.getLatLng();
        const distanceVal = parseFloat(document.getElementById('loop-distance-input').value) || 10;
        
        // Diamond/Square loop structure: S = D / 4
        const S = distanceVal / 4;
        
        // Lat/Lon deltas approximations
        const latRad = start.lat * Math.PI / 180;
        const deltaLatS = S / 111;
        const deltaLonS = S / (111 * Math.cos(latRad));

        // 8 directions: N, NE, E, SE, S, SW, W, NW
        const angles = [0, 45, 90, 135, 180, 225, 270, 315];

        fetchPromises = angles.map((angle, idx) => {
            const rad1 = (angle - 45) * Math.PI / 180;
            const rad2 = angle * Math.PI / 180;
            const rad3 = (angle + 45) * Math.PI / 180;

            const w1_lat = start.lat + deltaLatS * Math.cos(rad1);
            const w1_lng = start.lng + deltaLonS * Math.sin(rad1);

            const w2_lat = start.lat + Math.sqrt(2) * deltaLatS * Math.cos(rad2);
            const w2_lng = start.lng + Math.sqrt(2) * deltaLonS * Math.sin(rad2);

            const w3_lat = start.lat + deltaLatS * Math.cos(rad3);
            const w3_lng = start.lng + deltaLonS * Math.sin(rad3);

            const lonlats = `${start.lng},${start.lat}|${w1_lng.toFixed(6)},${w1_lat.toFixed(6)}|${w2_lng.toFixed(6)},${w2_lat.toFixed(6)}|${w3_lng.toFixed(6)},${w3_lat.toFixed(6)}|${start.lng},${start.lat}`;
            const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=trekking&format=geojson`;

            return fetch(url)
                .then(res => {
                    if (!res.ok) throw new Error("Błąd pobierania pętli");
                    return res.json();
                })
                .then(geojson => {
                    return { index: idx, geojson: geojson };
                })
                .catch(err => {
                    console.warn(`Loop candidate ${idx} at angle ${angle} failed`, err);
                    return null;
                });
        });
    }

    try {
        const results = await Promise.all(fetchPromises);
        hideLoader();

        // Filter out failed routes
        const validResults = results.filter(r => r !== null && r.geojson && r.geojson.features && r.geojson.features.length > 0);

        if (validResults.length === 0) {
            alert("Nie znaleziono tras dla wybranych punktów. Spróbuj zmienić lokalizację.");
            return;
        }

        // Process route metrics
        routesData = validResults.map(res => {
            const feature = res.geojson.features[0];
            const coordinates = feature.geometry.coordinates; // [[lon, lat, elev], ...]
            
            // Calculate distance (from features properties or coordinates)
            let distanceMeters = 0;
            if (feature.properties && feature.properties['track-length']) {
                distanceMeters = parseFloat(feature.properties['track-length']);
            } else {
                // Fallback computation
                for (let i = 0; i < coordinates.length - 1; i++) {
                    const p1 = L.latLng(coordinates[i][1], coordinates[i][0]);
                    const p2 = L.latLng(coordinates[i+1][1], coordinates[i+1][0]);
                    distanceMeters += p1.distanceTo(p2);
                }
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
                    const p1 = L.latLng(coordinates[i-1][1], coordinates[i-1][0]);
                    const p2 = L.latLng(coordinates[i][1], coordinates[i][0]);
                    const dist = p1.distanceTo(p2);
                    currentDist += dist;
                    
                    const diff = elev - coordinates[i-1][2];
                    if (diff > 0) {
                        elevationGain += diff;
                    } else {
                        elevationLoss += Math.abs(diff);
                    }
                }
                distances.push(currentDist / 1000); // km
            }

            return {
                index: res.index,
                coordinates: coordinates,
                distanceKm: (distanceMeters / 1000).toFixed(1),
                elevationGain: Math.round(elevationGain),
                elevationLoss: Math.round(elevationLoss),
                timeMinutes: Math.round((distanceMeters / 1000) / 15 * 60), // Assumes 15km/h average bike speed
                elevations: elevations,
                distances: distances
            };
        });

        // Identify the one with minimum elevation gain
        let flatestIdx = 0;
        let minGain = Infinity;
        routesData.forEach((route, idx) => {
            if (route.elevationGain < minGain) {
                minGain = route.elevationGain;
                flatestIdx = idx;
            }
        });
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
            weight: 5,
            opacity: 0.6,
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
            const directions = [
                "Pętla Północna (N)", 
                "Pętla Pn-Wsch (NE)", 
                "Pętla Wschodnia (E)", 
                "Pętla Pd-Wsch (SE)", 
                "Pętla Południowa (S)", 
                "Pętla Pd-Zach (SW)", 
                "Pętla Zachodnia (W)", 
                "Pętla Pn-Zach (NW)"
            ];
            routeName = directions[route.index] || `Pętla ${idx + 1}`;
        }
        
        let badgeHtml = '';
        if (route.isFlatest) {
            badgeHtml = `<span class="badge badge-flatest"><i data-lucide="sparkles" style="display:inline-block; width:10px; height:10px; margin-right:4px;"></i>Najbardziej płaska</span>`;
        } else {
            badgeHtml = `<span class="badge badge-alt">${currentMode === 'loop' ? 'Alternatywna' : `Alternatywna ${idx}`}</span>`;
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
            <div style="display: flex; justify-content: flex-end; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                <button class="gpx-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 10px; font-size: 11px; color: var(--text-primary); cursor: pointer; display: flex; align-items: center; gap: 4px; transition: background 0.2s;">
                    <i data-lucide="download" style="width: 12px; height: 12px;"></i> GPX
                </button>
            </div>
        `;

        card.addEventListener('click', () => selectRoute(idx));
        card.querySelector('.gpx-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            exportRouteGPX(route, routeName);
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
            weight: 5,
            opacity: 0.6,
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
    loader.querySelector('.loader-text').textContent = text;
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
function exportRouteGPX(route, routeName) {
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

        if (window.AndroidInterface && window.AndroidInterface.shareGPX) {
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
