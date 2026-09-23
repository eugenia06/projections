// ============================================================
// МОДУЛЬ БАЗЫ ПРОЕКЦИЙ (data.json)
// ============================================================
const ProjectionDB = (function() {
    let db = {};
    let list = [];
    let loaded = false;

    // ---------- Загрузка ----------
    async function load(url) {
        if (loaded) return db;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Не удалось загрузить ' + url);
        const raw = await resp.json();

        Object.keys(raw).forEach(key => {
            const def = raw[key];
            def.code = String(def.code || key);
            def.fullCode = def.code.includes(':')
                ? def.code
                : `${def.source || 'EPSG'}:${def.code}`;

            // ВАЖНО: приоритет WKT1 — proj4js стабильнее с ним
            def._definition = (def.WKT1 && def.WKT1 !== '-')
                ? def.WKT1
                : ((def.WKT2 && def.WKT2 !== '-') ? def.WKT2 : null);

            if (def._definition) {
                try {
                    proj4.defs(def.fullCode, def._definition);
                    if (!def.code.includes(':')) {
                        proj4.defs(def.code, def._definition);
                    }
                } catch (e) {
                    console.warn('Ошибка proj4.defs для', def.fullCode, e);
                    def._unsupported = true;
                }
            } else {
                def._unsupported = true;
            }

            db[def.fullCode] = def;
            db[def.code] = def;
            list.push(def);
        });

        loaded = true;
        console.log('[ProjectionDB] загружено:', list.length, 'проекций');
        return db;
    }

    // ---------- Геттеры ----------
    function getAll() { return list; }

    function get(code) {
        if (!code) return null;
        return db[code] || db[`EPSG:${code}`] || null;
    }

    function search(q) {
        if (!q) return list;
        const s = q.toLowerCase();
        return list.filter(p =>
            (p.code || '').toLowerCase().includes(s) ||
            (p.name || '').toLowerCase().includes(s) ||
            (p.Place || '').toLowerCase().includes(s) ||
            (p.datum || '').toLowerCase().includes(s)
        );
    }

    // ---------- Построение CRS ----------
    function createCRS(code) {
        const def = get(code);
        if (!def) {
            console.warn('Проекция не найдена:', code);
            return L.CRS.EPSG3857;
        }
        if (def._unsupported || !def._definition) {
            console.warn('Проекция без WKT:', code);
            return L.CRS.EPSG3857;
        }
        if (def.fullCode === 'EPSG:4326') return L.CRS.EPSG4326;

        const projStr = def._definition;
        const resolutions = buildResolutions(def);
        const origin = buildOrigin(def, projStr);
        const bounds = buildBounds(def, projStr);

        try {
            const crs = new L.Proj.CRS(def.fullCode, projStr, {
                resolutions: resolutions,
                origin: origin,
                bounds: bounds
            });
            console.log('[createCRS]', def.fullCode, 'OK');
            return crs;
        } catch (e) {
            console.error('Не удалось создать CRS', def.fullCode, e);
            return L.CRS.EPSG3857;
        }
    }

    function buildResolutions(def) {
        const units = (def.Dlina || '').toLowerCase();
        const model = (def.MathModel || '').toLowerCase();
        const isDegree = units.includes('degree') || def.type === 'Географическая';

        const res = [];
        if (isDegree) {
            for (let i = 0; i < 22; i++) res.push(0.703125 / Math.pow(2, i));
        } else if (model.includes('mercator') && !model.includes('transverse')) {
            for (let i = 0; i < 22; i++) res.push(156543.03392804097 / Math.pow(2, i));
        } else {
            for (let i = 0; i < 22; i++) res.push(1222.99245256282 / Math.pow(2, i));
        }
        return res;
    }

    function buildOrigin(def, projStr) {
        const bbox = def.Granica;
        if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;
        try {
            const p = proj4('EPSG:4326', projStr, [bbox[0], bbox[3]]);
            return [p[0], p[1]];
        } catch (e) {
            return undefined;
        }
    }

    function buildBounds(def, projStr) {
        const bbox = def.Granica;
        if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;
        try {
            const p1 = proj4('EPSG:4326', projStr, [bbox[0], bbox[1]]);
            const p2 = proj4('EPSG:4326', projStr, [bbox[2], bbox[3]]);
            return L.bounds([p1[0], p1[1]], [p2[0], p2[1]]);
        } catch (e) {
            return undefined;
        }
    }

    return { load, getAll, get, search, createCRS, isLoaded: () => loaded };
})();


// ============================================================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ============================================================
let map1 = null;
let map2 = null;

let polygon = null;
let polygon2 = null;
let polygonPoints = [];
let tempPolyline = null;
let isDrawing = false;
let markers = [];
let dragMarkers = [];
let isDragging = false;
let isEditing = false;
let savedPolygons = [];

let currentCRS1 = L.CRS.EPSG3857;
let currentCRS2 = L.CRS.EPSG3857;
let currentProjectionCode1 = 'EPSG:3857';
let currentProjectionCode2 = 'EPSG:3857';


// ============================================================
// СОЗДАНИЕ КАРТ
// ============================================================
function createMapWithCRS(containerId, crs) {
    return L.map(containerId, {
        crs: crs,
        center: [59.5, 30],
        zoom: 7,
        zoomControl: true,
        continuousWorld: true
    });
}

/**
 * Добавляет OSM-тайлы, если проекция глобальная (Web Mercator).
 * Для локальных проекций тайлы не имеют смысла — OSM отдаёт только 3857.
 */
function addTileLayer(map, def) {
    const bbox = def && def.Granica;
    const isWorldWide = Array.isArray(bbox) && (bbox[2] - bbox[0]) > 180;

    if (def && !isWorldWide) {
        console.warn('[addTileLayer] локальная проекция', def.fullCode, '— OSM-тайлы отключены');
        return;
    }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);
}


// ============================================================
// СОХРАНЕНИЕ ПОЛИГОНА
// ============================================================
function savePolygon() {
    if (!polygon) {
        showToast('Нет полигона для сохранения!', 2000);
        return false;
    }
    const coords = polygon.getLatLngs()[0];
    if (!coords || coords.length < 3) {
        showToast('Полигон должен иметь минимум 3 точки!', 2000);
        return false;
    }
    const polygonData = {
        id: Date.now(),
        coordinates: coords.map(p => ({ lat: p.lat, lng: p.lng })),
        center: polygon.getBounds().getCenter(),
        created: new Date().toLocaleString()
    };
    savedPolygons.push(polygonData);

    try {
        localStorage.setItem('savedPolygons', JSON.stringify(savedPolygons));
    } catch (e) {
        console.warn('Не удалось сохранить в localStorage', e);
    }

    updateSavedPolygonsList();
    showToast(`Полигон сохранён! ID: ${polygonData.id}`, 2000);
    return true;
}

function loadSavedPolygons() {
    try {
        const data = localStorage.getItem('savedPolygons');
        if (data) {
            savedPolygons = JSON.parse(data);
            updateSavedPolygonsList();
        }
    } catch (e) {
        console.warn('Не удалось загрузить сохранённые полигоны', e);
    }
}

function updateSavedPolygonsList() {
    const container = document.getElementById('savedPolygonsContainer');
    if (!container) return;

    if (savedPolygons.length === 0) {
        container.innerHTML = '<div class="empty-list">Нет сохранённых полигонов</div>';
        return;
    }

    let html = '';
    savedPolygons.forEach((poly, index) => {
        html += `
            <div class="saved-polygon-item">
                <div class="polygon-header">
                    <span class="polygon-id">#${poly.id}</span>
                    <div class="polygon-actions">
                        <button onclick="loadPolygon(${index})" class="load-btn">Загрузить</button>
                        <button onclick="deleteSavedPolygon(${index})" class="delete-btn">✕</button>
                    </div>
                </div>
                <div class="polygon-stats">
                    <span>Точек: ${poly.coordinates.length}</span>
                    <span>Дата: ${poly.created}</span>
                </div>
                <div class="polygon-coords-table">
                    <table>
                        <thead>
                            <tr>
                                <th>№</th>
                                <th>Широта</th>
                                <th>Долгота</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${poly.coordinates.map((p, i) => `
                                <tr>
                                    <td>${i + 1}</td>
                                    <td>${p.lat.toFixed(6)}</td>
                                    <td>${p.lng.toFixed(6)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function loadPolygon(index) {
    const polyData = savedPolygons[index];
    if (!polyData) return;
    if (polygon) {
        map1.removeLayer(polygon);
        polygon = null;
        clearDrawing();
    }
    const coords = polyData.coordinates.map(p => [p.lat, p.lng]);
    const closedPoints = [...coords, coords[0]];

    polygon = L.polygon(closedPoints, {
        color: '#306bff', weight: 3,
        fillColor: '#84a7fe', fillOpacity: 0.3
    }).addTo(map1);
    polygon.bindPopup(`Полигон #${polyData.id}`);
    polygon.on('click', updateInfo);

    if (polygon2) {
        map2.removeLayer(polygon2);
    }
    polygon2 = L.polygon(closedPoints, {
        color: '#ef4444', weight: 3,
        fillColor: '#fca5a5', fillOpacity: 0.3
    }).addTo(map2);

    createDragMarkers();
    updateInfo();
    setTimeout(centerOnPolygon, 100);
    showToast(`Полигон #${polyData.id} загружен`, 2000);
}

function deleteSavedPolygon(index) {
    if (!confirm('Удалить сохранённый полигон?')) return;
    savedPolygons.splice(index, 1);
    try {
        localStorage.setItem('savedPolygons', JSON.stringify(savedPolygons));
    } catch (e) {
        console.warn('Не удалось обновить localStorage', e);
    }
    updateSavedPolygonsList();
    showToast('Полигон удалён из сохранённых', 1500);
}


// ============================================================
// РЕДАКТИРОВАНИЕ
// ============================================================
function finishEditing() {
    if (!polygon) {
        showToast('Нет полигона для завершения редактирования', 2000);
        return;
    }
    if (!isEditing) {
        showToast('Режим редактирования не активен', 2000);
        return;
    }

    isEditing = false;
    dragMarkers.forEach(m => map1.removeLayer(m));
    dragMarkers = [];

    const coords = polygon.getLatLngs()[0];
    map1.removeLayer(polygon);
    polygon = L.polygon(coords, {
        color: '#306bff', weight: 3,
        fillColor: '#84a7fe', fillOpacity: 0.3
    }).addTo(map1);
    polygon.bindPopup('Полигон (редактирование завершено)');
    polygon.on('click', updateInfo);

    if (polygon2) {
        map2.removeLayer(polygon2);
        polygon2 = L.polygon(coords, {
            color: '#ef4444', weight: 3,
            fillColor: '#fca5a5', fillOpacity: 0.3
        }).addTo(map2);
    }

    map1.getContainer().style.cursor = '';
    updateInfo();
    showToast('Редактирование завершено!', 2000);
}

function startEditing() {
    if (!polygon) {
        showToast('Сначала создайте полигон!', 2000);
        return;
    }
    if (isEditing) {
        showToast('Уже идёт редактирование', 1500);
        return;
    }
    isEditing = true;
    createDragMarkers();
    showToast('Режим редактирования активирован. Перетаскивайте точки.', 2000);
}


// ============================================================
// TOAST И ИНФО
// ============================================================
function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast1');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, duration);
}

function updateInfo() {
    const pointCountEl = document.getElementById('pointCount');
    const centerEl = document.getElementById('center');
    if (!pointCountEl || !centerEl) return;

    if (!polygon) {
        pointCountEl.textContent = '0';
        centerEl.textContent = '—';
        return;
    }

    const coords = polygon.getLatLngs()[0];
    if (!coords || coords.length < 3) return;

    pointCountEl.textContent = coords.length;

    const center = polygon.getBounds().getCenter();

    // Координаты в текущей проекции
    let projStr = '';
    try {
        if (map1 && map1.options && map1.options.crs && map1.options.crs.projection) {
            const projXY = map1.options.crs.projection.project(center);
            const def = ProjectionDB.get(currentProjectionCode1);
            const units = def ? (def.Dlina || '') : '';
            projStr = ` (${projXY.x.toFixed(2)}, ${projXY.y.toFixed(2)} ${units})`;
        }
    } catch (e) {
        // ignore
    }

    centerEl.textContent =
        `${center.lat.toFixed(4)}°, ${center.lng.toFixed(4)}°${projStr}`;
}


// ============================================================
// ЦЕНТРИРОВАНИЕ И ОЧИСТКА
// ============================================================
function centerOnPolygon() {
    if (polygon) {
        map1.fitBounds(polygon.getBounds(), { padding: [50, 50], maxZoom: 18 });
        map2.fitBounds(polygon.getBounds(), { padding: [50, 50], maxZoom: 18 });
    }
}

function clearDrawing() {
    markers.forEach(m => map1.removeLayer(m));
    markers = [];

    dragMarkers.forEach(m => map1.removeLayer(m));
    dragMarkers = [];

    if (tempPolyline) {
        map1.removeLayer(tempPolyline);
        tempPolyline = null;
    }

    polygonPoints = [];
    isDrawing = false;
    isDragging = false;
    isEditing = false;
    map1.getContainer().style.cursor = '';
    map1.off('click', addPointOnClick);
    map1.off('dblclick', finishPolygon);
}


// ============================================================
// МАРКЕРЫ РЕДАКТИРОВАНИЯ
// ============================================================
function createDragMarkers() {
    if (!isEditing) return;

    dragMarkers.forEach(m => map1.removeLayer(m));
    dragMarkers = [];

    if (!polygon) return;

    const coords = polygon.getLatLngs()[0];
    if (!coords || coords.length < 3) return;

    const points = coords;

    for (let i = 0; i < points.length; i++) {
        const lat = points[i].lat;
        const lng = points[i].lng;

        const marker = L.marker([lat, lng], {
            draggable: true,
            icon: L.divIcon({
                className: 'drag-marker',
                html: '<div></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            })
        }).addTo(map1);
        marker._pointIndex = i;

        marker.on('dragstart', function() {
            isDragging = true;
            this._icon.classList.add('dragging');
            map1.getContainer().style.cursor = 'grabbing';
        });

        marker.on('drag', function(e) {
            const latlng = e.target.getLatLng();
            const idx = this._pointIndex;
            const coords = polygon.getLatLngs()[0];
            coords[idx].lat = latlng.lat;
            coords[idx].lng = latlng.lng;

            map1.removeLayer(polygon);
            polygon = L.polygon(coords, {
                color: '#f59e0b', weight: 3,
                fillColor: '#84a7fe', fillOpacity: 0.3
            }).addTo(map1);
            polygon.bindPopup('Полигон (редактируется)');
            polygon.on('click', updateInfo);

            if (polygon2) {
                map2.removeLayer(polygon2);
                polygon2 = L.polygon(coords, {
                    color: '#ef4444', weight: 3,
                    fillColor: '#fca5a5', fillOpacity: 0.3
                }).addTo(map2);
            }

            updateInfo();
        });

        marker.on('dragend', function() {
            isDragging = false;
            this._icon.classList.remove('dragging');
            map1.getContainer().style.cursor = '';
            createDragMarkers();
            updateInfo();
            showToast('Точка перемещена', 1500);
        });

        dragMarkers.push(marker);

        const numMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'drag-point-number',
                html: `<div>${i + 1}</div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map1);
        dragMarkers.push(numMarker);
    }
}


// ============================================================
// СОЗДАНИЕ ПОЛИГОНА
// ============================================================
function addPointOnClick(e) {
    if (!isDrawing) return;

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const point = [lat, lng];

    polygonPoints.push(point);

    const marker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'point-marker',
            html: '<div></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        })
    }).addTo(map1);
    markers.push(marker);

    const numMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'point-number',
            html: `<div>${polygonPoints.length}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map1);
    markers.push(numMarker);

    if (tempPolyline) {
        map1.removeLayer(tempPolyline);
    }

    if (polygonPoints.length > 1) {
        tempPolyline = L.polyline(polygonPoints, {
            color: '#3b82f6', weight: 3,
            dashArray: '8, 6', opacity: 0.8
        }).addTo(map1);
    }

    document.getElementById('pointCount').textContent = polygonPoints.length;
}

function finishPolygon() {
    if (!isDrawing) return;

    if (polygonPoints.length < 3) {
        showToast('Нужно минимум 3 точки для создания полигона!');
        clearDrawing();
        return;
    }

    const closedPoints = [...polygonPoints, polygonPoints[0]];

    polygon = L.polygon(closedPoints, {
        color: '#306bff', weight: 3,
        fillColor: '#84a7fe', fillOpacity: 0.3
    }).addTo(map1);
    polygon.bindPopup('Полигон создан');
    polygon.on('click', updateInfo);

    polygon2 = L.polygon(closedPoints, {
        color: '#ef4444', weight: 3,
        fillColor: '#fca5a5', fillOpacity: 0.3
    }).addTo(map2);

    markers.forEach(m => map1.removeLayer(m));
    markers = [];

    if (tempPolyline) {
        map1.removeLayer(tempPolyline);
        tempPolyline = null;
    }

    isDrawing = false;
    map1.getContainer().style.cursor = '';
    map1.off('click', addPointOnClick);
    map1.off('dblclick', finishPolygon);
    polygonPoints = [];

    updateInfo();
    setTimeout(centerOnPolygon, 100);
    showToast('Полигон создан!', 2000);
}


// ============================================================
// ПЕРЕКЛЮЧЕНИЕ ПРОЕКЦИЙ
// ============================================================
function switchProjection(map, newCode, isMap1) {
    console.log('[switchProjection]', isMap1 ? 'map1' : 'map2', '→', newCode);

    const oldCenter = map.getCenter();
    const oldZoom = map.getZoom();

    const newCRS = ProjectionDB.createCRS(newCode);
    console.log('  newCRS:', newCRS ? newCRS.code : 'null');

    const containerId = isMap1 ? 'map1' : 'map2';
    map.remove();
    const newMap = createMapWithCRS(containerId, newCRS);

    const def = ProjectionDB.get(newCode);
    addTileLayer(newMap, def);

    // Центр: по bbox новой проекции, если есть
    let center = [oldCenter.lat, oldCenter.lng];
    if (def && Array.isArray(def.Granica) && def.Granica.length === 4) {
        const bbox = def.Granica;
        center = [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];
    }
    newMap.setView(center, oldZoom);

    if (isMap1) {
        map1 = newMap;
        currentCRS1 = newCRS;
        currentProjectionCode1 = newCode;
        redrawPolygonOnMap1();
        attachMap1Handlers();
    } else {
        map2 = newMap;
        currentCRS2 = newCRS;
        currentProjectionCode2 = newCode;
        redrawPolygonOnMap2();
    }

    showToast(`Проекция: ${def ? def.name : newCode}`, 2000);
}

function redrawPolygonOnMap1() {
    if (!polygon) return;
    const coords = polygon.getLatLngs()[0].map(p => [p.lat, p.lng]);
    map1.removeLayer(polygon);
    polygon = L.polygon(coords, {
        color: '#306bff', weight: 3,
        fillColor: '#84a7fe', fillOpacity: 0.3
    }).addTo(map1);
    polygon.on('click', updateInfo);
    if (isEditing) createDragMarkers();
    updateInfo();
}

function redrawPolygonOnMap2() {
    if (!polygon2 && !polygon) return;
    let coords;
    if (polygon) {
        coords = polygon.getLatLngs()[0].map(p => [p.lat, p.lng]);
    } else {
        coords = polygon2.getLatLngs()[0].map(p => [p.lat, p.lng]);
    }
    if (polygon2) map2.removeLayer(polygon2);
    polygon2 = L.polygon(coords, {
        color: '#ef4444', weight: 3,
        fillColor: '#fca5a5', fillOpacity: 0.3
    }).addTo(map2);
}

function attachMap1Handlers() {
    if (isDrawing) {
        map1.getContainer().style.cursor = 'crosshair';
        map1.on('click', addPointOnClick);
        map1.on('dblclick', finishPolygon);
    }
}


// ============================================================
// UI ПАНЕЛИ ПРОЕКЦИЙ
// ============================================================
function fillSelect(select, list, selectedCode) {
    select.innerHTML = '';
    list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.fullCode;
        opt.textContent = `${p.fullCode} — ${p.name}`;
        if (p.fullCode === selectedCode) opt.selected = true;
        select.appendChild(opt);
    });
}

function renderInfo(container, def) {
    if (!def) {
        container.classList.remove('visible');
        return;
    }
    const ell = Array.isArray(def.ellipsoid)
        ? `${def.ellipsoid[0]} (a=${def.ellipsoid[1]}, 1/f=${def.ellipsoid[2]})`
        : (def.ellipsoid || '—');
    const bbox = Array.isArray(def.Granica)
        ? def.Granica.join(', ')
        : (def.Granica || '—');
    container.innerHTML = `
        <b>${def.fullCode}</b> — ${def.name}<br>
        <b>Тип:</b> ${def.type} &nbsp;|&nbsp;
        <b>Модель:</b> ${def.MathModel || '—'} &nbsp;|&nbsp;
        <b>Датум:</b> ${def.datum || '—'}<br>
        <b>Эллипсоид:</b> ${ell}<br>
        <b>Единицы:</b> ${def.Dlina || '—'} &nbsp;|&nbsp;
        <b>Применение:</b> ${def.Primenenie || '—'}<br>
        <b>Территория:</b> ${def.Place || '—'}<br>
        <b>Границы:</b> ${bbox}
    `;
    container.classList.add('visible');
}

function setupProjectionPanel(opts) {
    const all = ProjectionDB.getAll();
    fillSelect(opts.select, all, opts.getCurrentCode());
    renderInfo(opts.info, ProjectionDB.get(opts.getCurrentCode()));

    opts.search.addEventListener('input', function() {
        const filtered = ProjectionDB.search(this.value);
        fillSelect(opts.select, filtered, opts.getCurrentCode());
    });

    opts.select.addEventListener('change', function() {
        const code = this.value;
        renderInfo(opts.info, ProjectionDB.get(code));
        opts.onChange(code);
    });
}


// ============================================================
// ЭКСПОРТ В WINDOW (для onclick в HTML)
// ============================================================
window.loadPolygon = loadPolygon;
window.deleteSavedPolygon = deleteSavedPolygon;


// ============================================================
// ОБРАБОТЧИКИ КНОПОК
// ============================================================
function attachUIHandlers() {
    document.getElementById('createpolyBtn').addEventListener('click', function() {
        if (polygon) {
            showToast('Сначала удалите существующий полигон!');
            return;
        }
        if (isDrawing) {
            showToast('Уже идёт создание полигона');
            return;
        }
        clearDrawing();
        isDrawing = true;
        polygonPoints = [];
        map1.getContainer().style.cursor = 'crosshair';
        showToast('Кликайте на карте для добавления точек. Двойной клик — завершить.', 4000);
        map1.on('click', addPointOnClick);
        map1.on('dblclick', finishPolygon);
    });

    document.getElementById('fitBoundsBtn').addEventListener('click', centerOnPolygon);

    document.getElementById('addPointBtn').addEventListener('click', function() {
        if (!polygon) {
            showToast('Сначала создайте полигон!');
            return;
        }
        const coords = polygon.getLatLngs()[0];
        if (!coords || coords.length < 3) {
            showToast('Некорректный полигон');
            return;
        }
        if (isDrawing) {
            showToast('Уже идёт добавление точки');
            return;
        }
        isDrawing = true;
        map1.getContainer().style.cursor = 'crosshair';
        showToast('Кликните на карте для добавления точки', 3000);

        function addPointToPolygon(e) {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            const currentCoords = polygon.getLatLngs()[0];
            const newPoint = L.latLng(lat, lng);
            currentCoords.splice(currentCoords.length, 0, newPoint);

            map1.removeLayer(polygon);
            polygon = L.polygon(currentCoords, {
                color: '#306bff', weight: 3,
                fillColor: '#84a7fe', fillOpacity: 0.3
            }).addTo(map1);
            polygon.bindPopup('Полигон — добавлена точка');
            polygon.on('click', updateInfo);

            if (polygon2) {
                map2.removeLayer(polygon2);
                polygon2 = L.polygon(currentCoords, {
                    color: '#ef4444', weight: 3,
                    fillColor: '#fca5a5', fillOpacity: 0.3
                }).addTo(map2);
            }
            if (isEditing) createDragMarkers();

            updateInfo();
            centerOnPolygon();
            isDrawing = false;
            map1.getContainer().style.cursor = '';
            map1.off('click', addPointToPolygon);
            showToast('Точка добавлена', 1500);
        }
        map1.on('click', addPointToPolygon);
    });

    document.getElementById('deleteBtn').addEventListener('click', function() {
        if (polygon && confirm('Удалить полигон?')) {
            map1.removeLayer(polygon);
            polygon = null;
            if (polygon2) {
                map2.removeLayer(polygon2);
                polygon2 = null;
            }
            clearDrawing();
            updateInfo();
            showToast('Полигон удалён', 1500);
        }
    });

    document.getElementById('savePolygonBtn').addEventListener('click', savePolygon);
    document.getElementById('editPolygonBtn').addEventListener('click', startEditing);
    document.getElementById('finishEditBtn').addEventListener('click', finishEditing);

    document.getElementById('clearAllBtn').addEventListener('click', function() {
        if (savedPolygons.length === 0) {
            showToast('Нет сохранённых полигонов');
            return;
        }
        if (!confirm(`Удалить все ${savedPolygons.length} сохранённых полигонов?`)) return;
        savedPolygons = [];
        try {
            localStorage.setItem('savedPolygons', JSON.stringify(savedPolygons));
        } catch (e) {
            console.warn('Не удалось очистить localStorage', e);
        }
        updateSavedPolygonsList();
        showToast('Все сохранённые полигоны удалены', 2000);
    });

    window.addEventListener('resize', function() {
        if (polygon) centerOnPolygon();
    });
}


// ============================================================
// ЗАПУСК
// ============================================================
(async function bootstrap() {
    try {
        // 1. Загружаем базу проекций
        await ProjectionDB.load('data.json');

        // 2. Создаём карты
        currentCRS1 = ProjectionDB.createCRS(currentProjectionCode1);
        currentCRS2 = ProjectionDB.createCRS(currentProjectionCode2);

        map1 = createMapWithCRS('map1', currentCRS1);
        map2 = createMapWithCRS('map2', currentCRS2);
        addTileLayer(map1, ProjectionDB.get(currentProjectionCode1));
        addTileLayer(map2, ProjectionDB.get(currentProjectionCode2));

        // 3. Настраиваем панели
        setupProjectionPanel({
            select: document.getElementById('projection1'),
            search: document.getElementById('projectionSearch1'),
            info:   document.getElementById('projectionInfo1'),
            getCurrentCode: () => currentProjectionCode1,
            onChange: (code) => switchProjection(map1, code, true)
        });

        setupProjectionPanel({
            select: document.getElementById('projection2'),
            search: document.getElementById('projectionSearch2'),
            info:   document.getElementById('projectionInfo2'),
            getCurrentCode: () => currentProjectionCode2,
            onChange: (code) => switchProjection(map2, code, false)
        });

        // 4. Обработчики кнопок
        attachUIHandlers();

        // 5. Дефолтный полигон
        const defaultCoords = [[59, 31], [59, 29], [60, 29], [60, 31], [59, 31]];
        polygon = L.polygon(defaultCoords, {
            color: '#306bff', weight: 3,
            fillColor: '#84a7fe', fillOpacity: 0.3
        }).addTo(map1);
        polygon.on('click', updateInfo);

        polygon2 = L.polygon(defaultCoords, {
            color: '#ef4444', weight: 3,
            fillColor: '#fca5a5', fillOpacity: 0.3
        }).addTo(map2);

        updateInfo();
        setTimeout(centerOnPolygon, 300);

        // 6. Загружаем сохранённые
        loadSavedPolygons();

        console.log('[bootstrap] приложение запущено');
    } catch (err) {
        console.error('Ошибка инициализации:', err);
        alert('Не удалось загрузить базу проекций: ' + err.message);
    }
})();