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

        const options = { resolutions: resolutions };
        if (origin) options.origin = origin;

        try {
            const crs = new L.Proj.CRS(def.fullCode, projStr, options);

            const test = crs.projection.project(L.latLng(0, 0));
            if (!test || !isFinite(test.x) || !isFinite(test.y)) {
                throw new Error('CRS не проходит проверку project()');
            }

            console.log('[createCRS]', def.fullCode, 'OK');
            return crs;
        } catch (e) {
            console.error('Не удалось создать CRS', def.fullCode, e);
            return L.CRS.EPSG3857;
        }
    }

    // ЕДИНЫЙ масштабный ряд для ВСЕХ проекций.
    function buildResolutions(def) {
        const res = [];
        for (let i = 0; i < 22; i++) {
            res.push(156543.03392804097 / Math.pow(2, i));
        }
        return res;
    }

    function buildOrigin(def, projStr) {
        const bbox = def.Granica;
        if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;

        const nums = bbox.map(Number);
        if (nums.some(v => !isFinite(v))) return undefined;

        try {
            const p = proj4('EPSG:4326', projStr, [nums[0], nums[3]]);
            if (!p || !isFinite(p[0]) || !isFinite(p[1])) return undefined;
            return [p[0], p[1]];
        } catch (e) {
            return undefined;
        }
    }

    function buildBounds(def, projStr) {
        const bbox = def.Granica;
        if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;

        const nums = bbox.map(Number);
        if (nums.some(v => !isFinite(v))) return undefined;

        try {
            const p1 = proj4('EPSG:4326', projStr, [nums[0], nums[1]]);
            const p2 = proj4('EPSG:4326', projStr, [nums[2], nums[3]]);
            if (!p1 || !p2) return undefined;
            if (![p1[0], p1[1], p2[0], p2[1]].every(isFinite)) return undefined;
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

let graticuleLayers1 = [];
let graticuleLayers2 = [];


// ============================================================
// СОЗДАНИЕ КАРТ
// ============================================================
function createMapWithCRS(containerId, crs) {
    return L.map(containerId, {
        crs: crs,
        center: [59.5, 30],
        zoom: 7,
        zoomControl: true,
        continuousWorld: true,
        attributionControl: false
    });
}


// ============================================================
// СЕТКА МЕРИДИАНОВ И ПАРАЛЛЕЛЕЙ (graticule)
// ============================================================
function addGraticule(map, def, isMap1) {
    const oldLayers = isMap1 ? graticuleLayers1 : graticuleLayers2;
    oldLayers.forEach(layer => {
        try { map.removeLayer(layer); } catch (e) {}
    });
    const newLayers = [];

    let step = 10;
    if (def && Array.isArray(def.Granica) && def.Granica.length === 4) {
        const nums = def.Granica.map(Number);
        if (nums.every(isFinite)) {
            const spanLng = Math.abs(nums[2] - nums[0]);
            const spanLat = Math.abs(nums[3] - nums[1]);
            const span = Math.max(spanLng, spanLat);
            if (span < 2)        step = 0.25;
            else if (span < 5)   step = 0.5;
            else if (span < 15)  step = 1;
            else if (span < 40)  step = 2;
            else if (span < 90)  step = 5;
            else                 step = 10;
        }
    }

    const latMin = -80, latMax = 80;
    const lngMin = -180, lngMax = 180;

    const graticuleStyle = {
        color: '#94a3b8',
        weight: 1,
        opacity: 0.6,
        interactive: false
    };

    for (let lng = lngMin; lng <= lngMax; lng += step) {
        const points = [];
        for (let lat = latMin; lat <= latMax; lat += 1) {
            points.push([lat, lng]);
        }
        newLayers.push(L.polyline(points, graticuleStyle).addTo(map));
    }

    for (let lat = latMin; lat <= latMax; lat += step) {
        const points = [];
        for (let lng = lngMin; lng <= lngMax; lng += 1) {
            points.push([lat, lng]);
        }
        newLayers.push(L.polyline(points, graticuleStyle).addTo(map));
    }

    newLayers.push(L.polyline([[0, lngMin], [0, lngMax]], {
        color: '#64748b', weight: 1.5, opacity: 0.85, interactive: false
    }).addTo(map));

    newLayers.push(L.polyline([[latMin, 0], [latMax, 0]], {
        color: '#64748b', weight: 1.5, opacity: 0.85, interactive: false
    }).addTo(map));

    for (let lng = lngMin; lng <= lngMax; lng += step) {
        if (lng === 0) continue;
        newLayers.push(L.marker([latMax, lng], {
            icon: L.divIcon({
                className: 'graticule-label',
                html: `<span>${lng}°</span>`,
                iconSize: [40, 14],
                iconAnchor: [20, 7]
            }),
            interactive: false
        }).addTo(map));
    }

    for (let lat = latMin + step; lat <= latMax - step; lat += step) {
        if (lat === 0) continue;
        newLayers.push(L.marker([lat, lngMin], {
            icon: L.divIcon({
                className: 'graticule-label',
                html: `<span>${lat}°</span>`,
                iconSize: [40, 14],
                iconAnchor: [20, 7]
            }),
            interactive: false
        }).addTo(map));
    }

    if (isMap1) graticuleLayers1 = newLayers;
    else        graticuleLayers2 = newLayers;

    console.log('[addGraticule]', isMap1 ? 'map1' : 'map2',
                'сетка построена, шаг =', step, '°, слоёв:', newLayers.length);
}


// ============================================================
// МАСШТАБНАЯ ЛИНЕЙКА + ЗУМ (левый нижний угол)
// ============================================================
function addScaleDisplay(map, def, isMap1) {
    const oldCtrl = isMap1 ? map._scaleCtrl1 : map._scaleCtrl2;
    if (oldCtrl) {
        try { map.removeControl(oldCtrl); } catch (e) {}
    }

    const ScaleBarControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function(m) {
            const div = L.DomUtil.create('div', 'scale-bar');
            this._div = div;
            this._map = m;
            this._update();
            m.on('zoomend moveend', this._update, this);
            return div;
        },
        onRemove: function(m) {
            m.off('zoomend moveend', this._update, this);
        },
        _update: function() {
            const m = this._map;
            if (!m) return;

            const zoom = m.getZoom();

            let mpp = null;
            try {
                const size = m.getSize();
                const y = size.y / 2;
                const p1 = m.containerPointToLatLng([0, y]);
                const p2 = m.containerPointToLatLng([100, y]);
                mpp = p1.distanceTo(p2) / 100;
            } catch (e) {
                mpp = null;
            }

            if (!mpp || !isFinite(mpp) || mpp <= 0) {
                this._div.innerHTML = `
                    <div class="scale-bar-row">
                        <span class="zoom-badge">z${zoom}</span>
                        <span class="scale-bar-label">—</span>
                    </div>
                `;
                return;
            }

            const targetPx = 100;
            const targetMeters = mpp * targetPx;

            const magnitude = Math.pow(10, Math.floor(Math.log10(targetMeters)));
            let niceMeters = magnitude;
            const candidates = [1, 2, 5, 10];
            for (const n of candidates) {
                const v = n * magnitude;
                if (v <= targetMeters) niceMeters = v;
            }
            if (niceMeters <= 0) niceMeters = magnitude;

            const pxLen = Math.max(30, Math.min(180, niceMeters / mpp));

            let label;
            if (niceMeters >= 1000) {
                label = (niceMeters / 1000) + ' км';
            } else if (niceMeters >= 1) {
                label = niceMeters + ' м';
            } else {
                label = (niceMeters * 100).toFixed(0) + ' см';
            }

            this._div.innerHTML = `
                <div class="scale-bar-row">
                    <span class="zoom-badge">z${zoom}</span>
                    <div class="scale-bar-graphic">
                        <div class="scale-bar-line" style="width:${pxLen}px;"></div>
                        <div class="scale-bar-label">${label}</div>
                    </div>
                </div>
            `;
        }
    });

    const ctrl = new ScaleBarControl();
    ctrl.addTo(map);

    if (isMap1) map._scaleCtrl1 = ctrl;
    else        map._scaleCtrl2 = ctrl;
}


// ============================================================
// РАВНЫЙ МАСШТАБ (одинаковый м/пиксель на обеих картах)
// ============================================================
function equalScale() {
    if (!map1 || !map2) return;

    function metersPerPixel(map) {
        try {
            const size = map.getSize();
            const y = size.y / 2;
            const p1 = map.containerPointToLatLng([0, y]);
            const p2 = map.containerPointToLatLng([100, y]);
            const d = p1.distanceTo(p2) / 100;
            return isFinite(d) && d > 0 ? d : null;
        } catch (e) {
            return null;
        }
    }

    const mpp1 = metersPerPixel(map1);
    const mpp2 = metersPerPixel(map2);

    if (!mpp1 || !mpp2) {
        showToast('Не удалось определить масштаб', 2000);
        return;
    }

    const targetMpp = (mpp1 + mpp2) / 2;

    function fitZoomToMpp(map, currentMpp) {
        const idealDelta = -Math.log2(targetMpp / currentMpp);
        const zoomDelta = Math.round(idealDelta);

        let newZoom = map.getZoom() + zoomDelta;
        const minZ = map.getMinZoom ? map.getMinZoom() : 0;
        const maxZ = map.getMaxZoom ? map.getMaxZoom() : 22;
        newZoom = Math.max(minZ, Math.min(maxZ, newZoom));

        map.setZoom(newZoom);

        const newMpp = metersPerPixel(map);
        return { newZoom, newMpp };
    }

    const r1 = fitZoomToMpp(map1, mpp1);
    const r2 = fitZoomToMpp(map2, mpp2);

    console.log('[equalScale] targetMpp =', targetMpp,
                '→ map1 z' + r1.newZoom, '(' + r1.newMpp.toFixed(2) + ' м/п)',
                'map2 z' + r2.newZoom, '(' + r2.newMpp.toFixed(2) + ' м/п)');
}


// ============================================================
// ПОКАЗАТЬ ВЕСЬ МИР (без fitBounds — перебор зумов)
// ============================================================
function showWorldView() {
    if (!map1 || !map2) return;

    function fitWorld(map) {
        // Перебираем зумы от 6 вниз до 0 и находим максимальный,
        // при котором весь мир ещё влезает в кадр.
        for (let z = 6; z >= 0; z--) {
            try {
                map.setView([0, 0], z, { animate: false });
                const b = map.getBounds();
                const sw = b.getSouthWest();
                const ne = b.getNorthEast();
                if (sw.lng <= -170 && ne.lng >= 170 &&
                    sw.lat <= -80 && ne.lat >= 80) {
                    return z;
                }
            } catch (e) {
                // пропускаем
            }
        }
        // fallback
        map.setView([0, 0], 2, { animate: false });
        return 2;
    }

    try {
        const z1 = fitWorld(map1);
        console.log('[showWorldView] map1 zoom =', z1);
    } catch (e) {
        console.warn('[showWorldView] map1:', e);
        try { map1.setView([0, 0], 2); } catch (_) {}
    }

    try {
        const z2 = fitWorld(map2);
        console.log('[showWorldView] map2 zoom =', z2);
    } catch (e) {
        console.warn('[showWorldView] map2:', e);
        try { map2.setView([0, 0], 2); } catch (_) {}
    }

    showToast('Показан весь мир', 1500);
}


// ============================================================
// ХЕЛПЕР: перерисовать полигон на обеих картах
// ============================================================
function redrawBothPolygons(coords, style1, style2) {
    if (!coords || coords.length < 3) return;

    if (map1 && polygon) {
        map1.removeLayer(polygon);
        polygon = L.polygon(coords, style1 || {
            color: '#306bff', weight: 3,
            fillColor: '#84a7fe', fillOpacity: 0.3
        }).addTo(map1);
        polygon.bindPopup('Полигон');
        polygon.on('click', updateInfo);
    }

    if (map2 && polygon2) {
        map2.removeLayer(polygon2);
        polygon2 = L.polygon(coords, style2 || {
            color: '#ef4444', weight: 3,
            fillColor: '#fca5a5', fillOpacity: 0.3
        }).addTo(map2);
    }
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

    if (isEditing) createDragMarkers();
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

    dragMarkers.forEach(m => { try { map1.removeLayer(m); } catch(e){} });
    dragMarkers = [];

    const coords = polygon.getLatLngs()[0];
    redrawBothPolygons(coords,
        { color: '#306bff', weight: 3, fillColor: '#84a7fe', fillOpacity: 0.3 },
        { color: '#ef4444', weight: 3, fillColor: '#fca5a5', fillOpacity: 0.3 }
    );

    if (polygon) polygon.bindPopup('Полигон (редактирование завершено)');

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

    let center;
    try {
        center = polygon.getBounds().getCenter();
    } catch (e) {
        centerEl.textContent = '—';
        return;
    }

    let projStr = '';
    try {
        if (map1 && map1.options && map1.options.crs && map1.options.crs.projection) {
            const projXY = map1.options.crs.projection.project(center);
            if (projXY && isFinite(projXY.x) && isFinite(projXY.y)) {
                const def = ProjectionDB.get(currentProjectionCode1);
                const units = def ? (def.Dlina || '') : '';
                projStr = ` (${projXY.x.toFixed(2)}, ${projXY.y.toFixed(2)} ${units})`;
            }
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
    if (!polygon) return;
    try {
        const bounds = polygon.getBounds();
        map1.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
        map2.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
    } catch (e) {
        console.warn('centerOnPolygon:', e);
    }
}

function clearDrawing() {
    markers.forEach(m => { try { map1.removeLayer(m); } catch(e){} });
    markers = [];

    dragMarkers.forEach(m => { try { map1.removeLayer(m); } catch(e){} });
    dragMarkers = [];

    if (tempPolyline) {
        try { map1.removeLayer(tempPolyline); } catch(e){}
        tempPolyline = null;
    }

    polygonPoints = [];
    isDrawing = false;
    isDragging = false;
    isEditing = false;
    if (map1) map1.getContainer().style.cursor = '';
    if (map1) {
        map1.off('click', addPointOnClick);
        map1.off('dblclick', finishPolygon);
    }
}


// ============================================================
// МАРКЕРЫ РЕДАКТИРОВАНИЯ
// ============================================================
function createDragMarkers() {
    if (!isEditing) return;

    dragMarkers.forEach(m => { try { map1.removeLayer(m); } catch(e){} });
    dragMarkers = [];

    if (!polygon) return;

    const coords = polygon.getLatLngs()[0];
    if (!coords || coords.length < 3) return;

    const points = coords.slice();
    if (points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (Math.abs(first.lat - last.lat) < 1e-9 &&
            Math.abs(first.lng - last.lng) < 1e-9) {
            points.pop();
        }
    }

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
            if (this._icon) this._icon.classList.add('dragging');
            map1.getContainer().style.cursor = 'grabbing';
        });

        marker.on('drag', function(e) {
            const latlng = e.target.getLatLng();
            const idx = this._pointIndex;
            const currentCoords = polygon.getLatLngs()[0];

            currentCoords[idx].lat = latlng.lat;
            currentCoords[idx].lng = latlng.lng;

            if (currentCoords.length > 1) {
                const first = currentCoords[0];
                const last = currentCoords[currentCoords.length - 1];
                if (Math.abs(first.lat - last.lat) < 1e-9 &&
                    Math.abs(first.lng - last.lng) < 1e-9) {
                    last.lat = first.lat;
                    last.lng = first.lng;
                }
            }

            if (map1 && polygon) {
                map1.removeLayer(polygon);
                polygon = L.polygon(currentCoords, {
                    color: '#f59e0b', weight: 3,
                    fillColor: '#84a7fe', fillOpacity: 0.3
                }).addTo(map1);
                polygon.bindPopup('Полигон (редактируется)');
                polygon.on('click', updateInfo);
            }

            if (map2 && polygon2) {
                map2.removeLayer(polygon2);
                polygon2 = L.polygon(currentCoords, {
                    color: '#ef4444', weight: 3,
                    fillColor: '#fca5a5', fillOpacity: 0.3
                }).addTo(map2);
            }

            updateInfo();
        });

        marker.on('dragend', function() {
            isDragging = false;
            if (this._icon) this._icon.classList.remove('dragging');
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
            }),
            interactive: false
        }).addTo(map1);
        dragMarkers.push(numMarker);
    }

    console.log('[createDragMarkers] маркеров:', dragMarkers.length / 2);
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

    const def = ProjectionDB.get(newCode);
    const newCRS = ProjectionDB.createCRS(newCode);

    let oldCenter = null;
    let oldZoom = 7;
    try {
        oldCenter = map.getCenter();
        oldZoom = map.getZoom();
    } catch (e) {
        console.warn('[switchProjection] не удалось получить старый центр:', e);
    }

    const containerId = isMap1 ? 'map1' : 'map2';

    const oldLayers = isMap1 ? graticuleLayers1 : graticuleLayers2;
    oldLayers.length = 0;

    if (isMap1) {
        polygon = null;
        dragMarkers = [];
    } else {
        polygon2 = null;
    }

    try {
        map.remove();
    } catch (e) {
        console.warn('[switchProjection] map.remove():', e);
    }

    const newMap = createMapWithCRS(containerId, newCRS);

    let center = [59.5, 30];
    if (def && Array.isArray(def.Granica) && def.Granica.length === 4) {
        const nums = def.Granica.map(Number);
        if (nums.every(isFinite)) {
            center = [(nums[1] + nums[3]) / 2, (nums[0] + nums[2]) / 2];
        }
    } else if (oldCenter && isFinite(oldCenter.lat) && isFinite(oldCenter.lng)) {
        center = [oldCenter.lat, oldCenter.lng];
    }

    try {
        newMap.setView(center, oldZoom);
    } catch (e) {
        console.error('[switchProjection] setView упал, откат на EPSG:3857:', e);
        try { newMap.remove(); } catch (_) {}

        const fallback = createMapWithCRS(containerId, L.CRS.EPSG3857);
        addGraticule(fallback, ProjectionDB.get('EPSG:3857'), isMap1);
        addScaleDisplay(fallback, ProjectionDB.get('EPSG:3857'), isMap1);
        fallback.setView([59.5, 30], 7);

        if (isMap1) {
            map1 = fallback;
            currentCRS1 = L.CRS.EPSG3857;
            currentProjectionCode1 = 'EPSG:3857';
        } else {
            map2 = fallback;
            currentCRS2 = L.CRS.EPSG3857;
            currentProjectionCode2 = 'EPSG:3857';
        }
        showToast('Проекция не поддерживается, откат на EPSG:3857', 3000);
        return;
    }

    addGraticule(newMap, def, isMap1);
    addScaleDisplay(newMap, def, isMap1);

    if (isMap1) {
        map1 = newMap;
        currentCRS1 = newCRS;
        currentProjectionCode1 = newCode;
        redrawPolygonOnMap1();
        attachMap1Handlers();
        if (isEditing) createDragMarkers();
    } else {
        map2 = newMap;
        currentCRS2 = newCRS;
        currentProjectionCode2 = newCode;
        redrawPolygonOnMap2();
    }

    showToast(`Проекция: ${def ? def.name : newCode}`, 2000);
}

function redrawPolygonOnMap1() {
    let coords = null;
    if (polygon) {
        coords = polygon.getLatLngs()[0].map(p => [p.lat, p.lng]);
    } else if (polygon2) {
        coords = polygon2.getLatLngs()[0].map(p => [p.lat, p.lng]);
    }
    if (!coords) return;

    polygon = L.polygon(coords, {
        color: '#306bff', weight: 3,
        fillColor: '#84a7fe', fillOpacity: 0.3
    }).addTo(map1);
    polygon.on('click', updateInfo);
    updateInfo();
}

function redrawPolygonOnMap2() {
    let coords = null;
    if (polygon) {
        coords = polygon.getLatLngs()[0].map(p => [p.lat, p.lng]);
    } else if (polygon2) {
        coords = polygon2.getLatLngs()[0].map(p => [p.lat, p.lng]);
    }
    if (!coords) return;

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

    function applyCode(code) {
        if (!code) return;
        opts.select.value = code;
        const def = ProjectionDB.get(code);
        renderInfo(opts.info, def);
        opts.onChange(code);
    }

    opts.search.addEventListener('input', function() {
        const q = this.value.trim();
        const filtered = ProjectionDB.search(q);
        fillSelect(opts.select, filtered, opts.getCurrentCode());

        if (q === '') {
            fillSelect(opts.select, all, opts.getCurrentCode());
            renderInfo(opts.info, ProjectionDB.get(opts.getCurrentCode()));
            return;
        }
        if (filtered.length === 1) {
            applyCode(filtered[0].fullCode);
        }
    });

    opts.search.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const q = this.value.trim();
            if (!q) return;
            const filtered = ProjectionDB.search(q);
            if (filtered.length > 0) {
                applyCode(filtered[0].fullCode);
                this.blur();
            }
        }
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

    document.getElementById('equalScaleBtn').addEventListener('click', equalScale);
    document.getElementById('worldViewBtn').addEventListener('click', showWorldView);

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
        await ProjectionDB.load('data.json');

        currentCRS1 = ProjectionDB.createCRS(currentProjectionCode1);
        currentCRS2 = ProjectionDB.createCRS(currentProjectionCode2);

        map1 = createMapWithCRS('map1', currentCRS1);
        map2 = createMapWithCRS('map2', currentCRS2);

        addGraticule(map1, ProjectionDB.get(currentProjectionCode1), true);
        addGraticule(map2, ProjectionDB.get(currentProjectionCode2), false);

        addScaleDisplay(map1, ProjectionDB.get(currentProjectionCode1), true);
        addScaleDisplay(map2, ProjectionDB.get(currentProjectionCode2), false);

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

        attachUIHandlers();

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

        loadSavedPolygons();

        console.log('[bootstrap] приложение запущено');
    } catch (err) {
        console.error('Ошибка инициализации:', err);
        alert('Не удалось загрузить базу проекций: ' + err.message);
    }
})();