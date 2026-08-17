const map1 = L.map('map1', {center: [59.5, 30], zoom: 7, zoomControl: true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '© OpenStreetMap', maxZoom: 20}).addTo(map1);

const map2 = L.map('map2', {center: [59.5, 30], zoom: 7, zoomControl: true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '© OpenStreetMap', maxZoom: 20}).addTo(map2);

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
let polygon2Points = [];
let tempPolyline2 = null;
let isDrawingOnMap2 = false;
let markers2 = [];

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
    const polygonData = {id: Date.now(), coordinates: coords.map(p => ({ lat: p.lat, lng: p.lng })), center: polygon.getBounds().getCenter(), created: new Date().toLocaleString()};
    savedPolygons.push(polygonData);
    
    try {
        localStorage.setItem('savedPolygons', JSON.stringify(savedPolygons));
    } catch (e) {
        console.warn('Не удалось сохранить в localStorage', e);
    }
    
    updateSavedPolygonsList();
    showToast(`Полигон сохранен! ID: ${polygonData.id}`, 2000);
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
        console.warn('Не удалось загрузить сохраненные полигоны', e);
    }
}

function updateSavedPolygonsList() {
    const container = document.getElementById('savedPolygonsContainer');
    if (!container) return;
    
    if (savedPolygons.length === 0) {
        container.innerHTML = '<div class="empty-list">Нет сохраненных полигонов</div>';
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
                    <span>Дата создания:${poly.created}</span>
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
    
    polygon = L.polygon(closedPoints, {color: '#306bff', weight: 3, fillColor: '#84a7fe', fillOpacity: 0.3}).addTo(map1);
    polygon.bindPopup(`Полигон #${polyData.id}`);
    polygon.on('click', function() {
        updateInfo();
    });
    
    if (polygon2) {
        map2.removeLayer(polygon2);
    }
    polygon2 = L.polygon(closedPoints, {color: '#ef4444', weight: 3, fillColor: '#fca5a5', fillOpacity: 0.3}).addTo(map2);
    
    createDragMarkers();
    updateInfo();
    setTimeout(centerOnPolygon, 100);
    showToast(`Полигон #${polyData.id} загружен`, 2000);
}

function deleteSavedPolygon(index) {
    if (!confirm('Удалить сохраненный полигон?')) return;
    savedPolygons.splice(index, 1);
    try {
        localStorage.setItem('savedPolygons', JSON.stringify(savedPolygons));
    } catch (e) {
        console.warn('Не удалось обновить localStorage', e);
    }
    updateSavedPolygonsList();
    showToast('Полигон удален из сохраненных', 1500);
}

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
    polygon = L.polygon(coords, {color: '#306bff', weight: 3, fillColor: '#84a7fe', fillOpacity: 0.3}).addTo(map1);
    polygon.bindPopup('Полигон (редактирование завершено)');
    polygon.on('click', function() {
        updateInfo();
    });
    
    if (polygon2) {
        map2.removeLayer(polygon2);
        polygon2 = L.polygon(coords, {color: '#ef4444', weight: 3, fillColor: '#fca5a5', fillOpacity: 0.3}).addTo(map2);
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
        showToast('Уже идет редактирование', 1500);
        return;
    }
    isEditing = true;
    createDragMarkers();
    showToast('Режим редактирования активирован. Перетаскивайте точки.', 2000);
}

window.loadPolygon = loadPolygon;
window.deleteSavedPolygon = deleteSavedPolygon;

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast1');
    toast.textContent = message;
    toast.classList.add('visible');
    
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, duration);
}

function updateInfo() {
    if (!polygon) {
        document.getElementById('pointCount').textContent = '0';
        document.getElementById('center').textContent = '—';
        return;
    }

    const coords = polygon.getLatLngs()[0];
    if (!coords || coords.length < 3) {
        return;
    }
    
    const count = coords.length;
    document.getElementById('pointCount').textContent = count;
    const center = polygon.getBounds().getCenter();
    document.getElementById('center').textContent = `${center.lat.toFixed(4)}°, ${center.lng.toFixed(4)}°`;
}

function centerOnPolygon() {
    if (polygon) {
        map1.fitBounds(polygon.getBounds(), {padding: [50, 50], maxZoom: 18});
        map2.fitBounds(polygon.getBounds(), {padding: [50, 50], maxZoom: 18});
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
    
        const marker = L.marker([lat, lng], {draggable: true, icon: L.divIcon({className: 'drag-marker', html: '<div></div>', iconSize: [18, 18],iconAnchor: [9, 9]})}).addTo(map1);
        marker._pointIndex = i;
        
        marker.on('dragstart', function(e) {
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
            polygon = L.polygon(coords, {color: '#f59e0b', weight: 3, fillColor: '#84a7fe', fillOpacity: 0.3}).addTo(map1);
            polygon.bindPopup('Полигон (редактируется)');
            polygon.on('click', function() {
                updateInfo();
            });
            
            if (polygon2) {
                map2.removeLayer(polygon2);
                polygon2 = L.polygon(coords, {color: '#ef4444', weight: 3, fillColor: '#fca5a5', fillOpacity: 0.3}).addTo(map2);
            }
            
            updateInfo();
        });
        
        marker.on('dragend', function(e) {
            isDragging = false;
            this._icon.classList.remove('dragging');
            map1.getContainer().style.cursor = '';
            createDragMarkers();
            updateInfo();
            showToast('Точка перемещена', 1500);
        });
        
        dragMarkers.push(marker);
        const numMarker = L.marker([lat, lng], {icon: L.divIcon({className: 'drag-point-number', html: `<div>${i+1}</div>`, iconSize: [20, 20], iconAnchor: [10, 10]})}).addTo(map1);
        dragMarkers.push(numMarker);
    }
}

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
        tempPolyline = L.polyline(polygonPoints, {color: '#3b82f6', weight: 3, dashArray: '8, 6', opacity: 0.8}).addTo(map1);
    }
    
    document.getElementById('pointCount').textContent = polygonPoints.length;
}

function finishPolygon(e) {
    if (!isDrawing) return;
    
    if (polygonPoints.length < 3) {
        showToast('Нужно минимум 3 точки для создания полигона!');
        clearDrawing();
        return;
    }
    
    const closedPoints = [...polygonPoints, polygonPoints[0]];
    
    polygon = L.polygon(closedPoints, {color: '#306bff', weight: 3, fillColor: '#84a7fe', fillOpacity: 0.3}).addTo(map1);
    polygon.bindPopup('Полигон создан');
    polygon.on('click', function() {
        updateInfo();
    });
    
    polygon2 = L.polygon(closedPoints, {color: '#ef4444', weight: 3, fillColor: '#fca5a5', fillOpacity: 0.3}).addTo(map2);
    
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


document.getElementById('createpolyBtn').addEventListener('click', function() {
    if (polygon) {
        showToast('Сначала удалите существующий полигон!');
        return;
    }
    if (isDrawing) {
        showToast('Уже идет создание полигона');
        return;
    }
    clearDrawing();
    isDrawing = true;
    polygonPoints = [];
    map1.getContainer().style.cursor = 'crosshair';
    showToast('Кликайте на карте для добавления точек. Двойной клик - завершить.', 4000);
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
        showToast('Уже идет добавление точки');
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
        polygon = L.polygon(currentCoords, {color: '#306bff', weight: 3, fillColor: '#84a7fe', fillOpacity: 0.3}).addTo(map1);
        polygon.bindPopup('Полигон - добавлена точка');
        polygon.on('click', function() {
            updateInfo();
        });
        if (polygon2) {
            map2.removeLayer(polygon2);
            polygon2 = L.polygon(currentCoords, {color: '#ef4444', weight: 3, fillColor: '#fca5a5', fillOpacity: 0.3}).addTo(map2);
        }
        if (isEditing) {
            createDragMarkers();
        }
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
        showToast('Полигон удален', 1500);
    }
});


document.getElementById('savePolygonBtn').addEventListener('click', savePolygon);
document.getElementById('editPolygonBtn').addEventListener('click', startEditing);
document.getElementById('finishEditBtn').addEventListener('click', finishEditing);

window.addEventListener('resize', function() {
    if (polygon) {
        centerOnPolygon();
    }
});

loadSavedPolygons();

const defaultCoords = [[59, 31], [59, 29], [60, 29], [60, 31], [59, 31]];
polygon = L.polygon(defaultCoords, {color: '#306bff', weight: 3, fillColor: '#84a7fe', fillOpacity: 0.3}).addTo(map1);
polygon.on('click', function() {
    updateInfo();
});

polygon2 = L.polygon(defaultCoords, {color: '#ef4444', weight: 3, fillColor: '#fca5a5', fillOpacity: 0.3}).addTo(map2);

createDragMarkers();
updateInfo();
setTimeout(centerOnPolygon, 300);