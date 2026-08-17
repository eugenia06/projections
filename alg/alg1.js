const map = L.map('map', {
    center: [60, 30],
    zoom: 19,
    zoomControl: true
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
}).addTo(map);

let polygon = null;
let polygonPoints = [];
let tempPolyline = null;
let isDrawing = false;
let markers = [];
let dragMarkers = [];
let isDragging = false;

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
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
    document.getElementById('center').textContent = 
        `${center.lat.toFixed(4)}°, ${center.lng.toFixed(4)}°`;
}

function centerOnPolygon() {
    if (polygon) {
        map.fitBounds(polygon.getBounds(), {
            padding: [50, 50],
            maxZoom: 18
        });
    }
}

function clearDrawing() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    dragMarkers.forEach(m => map.removeLayer(m));
    dragMarkers = [];
    
    if (tempPolyline) {
        map.removeLayer(tempPolyline);
        tempPolyline = null;
    }
    
    polygonPoints = [];
    isDrawing = false;
    isDragging = false;
    map.getContainer().style.cursor = '';
    map.off('click', addPointOnClick);
    map.off('dblclick', finishPolygon);
}

function createDragMarkers() {
    dragMarkers.forEach(m => map.removeLayer(m));
    dragMarkers = [];
    
    if (!polygon) return;
    
    const coords = polygon.getLatLngs()[0];
    if (!coords || coords.length < 3) return;
    
    const points = coords.slice(0, -1);
    
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
        }).addTo(map);
        
        marker._pointIndex = i;
        
        marker.on('dragstart', function(e) {
            isDragging = true;
            this._icon.classList.add('dragging');
            map.getContainer().style.cursor = 'grabbing';
        });
        
        marker.on('drag', function(e) {
            const latlng = e.target.getLatLng();
            const idx = this._pointIndex;
            
            const coords = polygon.getLatLngs()[0];
            coords[idx].lat = latlng.lat;
            coords[idx].lng = latlng.lng;
            
            map.removeLayer(polygon);
            polygon = L.polygon(coords, {
                color: '#306bff',
                weight: 3,
                fillColor: '#84a7fe',
                fillOpacity: 0.3
            }).addTo(map);
            
            polygon.bindPopup('Полигон (редактируется)');
            polygon.on('click', function() {
                updateInfo();
            });
            
            updateInfo();
        });
        
        marker.on('dragend', function(e) {
            isDragging = false;
            this._icon.classList.remove('dragging');
            map.getContainer().style.cursor = '';
            createDragMarkers();
            updateInfo();
            showToast('Точка перемещена', 1500);
        });
        
        dragMarkers.push(marker);
        
        const numMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'drag-point-number',
                html: `<div>${i+1}</div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map);
        
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
    }).addTo(map);
    markers.push(marker);
    
    const numMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'point-number',
            html: `<div>${polygonPoints.length}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    markers.push(numMarker);
    
    if (tempPolyline) {
        map.removeLayer(tempPolyline);
    }
    
    if (polygonPoints.length > 1) {
        tempPolyline = L.polyline(polygonPoints, {
            color: '#3b82f6',
            weight: 3,
            dashArray: '8, 6',
            opacity: 0.8
        }).addTo(map);
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
    
    polygon = L.polygon(closedPoints, {
        color: '#306bff',
        weight: 3,
        fillColor: '#84a7fe',
        fillOpacity: 0.3
    }).addTo(map);
    
    polygon.bindPopup('Полигон создан');
    
    polygon.on('click', function() {
        updateInfo();
    });
    
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    if (tempPolyline) {
        map.removeLayer(tempPolyline);
        tempPolyline = null;
    }
    
    isDrawing = false;
    map.getContainer().style.cursor = '';
    map.off('click', addPointOnClick);
    map.off('dblclick', finishPolygon);
    polygonPoints = [];
    
    createDragMarkers();
    
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
    map.getContainer().style.cursor = 'crosshair';
    showToast('Кликайте на карте для добавления точек. Двойной клик - завершить.', 4000);
    
    map.on('click', addPointOnClick);
    map.on('dblclick', finishPolygon);
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
    
    const last = coords[coords.length - 2];
    const newPoint = [last.lat + 0.005, last.lng + 0.005];
    
    coords.splice(coords.length , 0, newPoint);
    
    map.removeLayer(polygon);
    polygon = L.polygon(coords, {
        color: '#306bff',
        weight: 3,
        fillColor: '#84a7fe',
        fillOpacity: 0.3
    }).addTo(map);
    
    polygon.bindPopup('Полигон (добавлена точка)');
    polygon.on('click', function() {
        updateInfo();
    });
    
    createDragMarkers();
    
    updateInfo();
    centerOnPolygon();
    showToast('Точка добавлена!', 1500);
});

document.getElementById('deleteBtn').addEventListener('click', function() {
    if (polygon && confirm('Удалить полигон?')) {
        map.removeLayer(polygon);
        polygon = null;
        clearDrawing();
        updateInfo();
        showToast('Полигон удален', 1500);
    }
});

window.addEventListener('resize', function() {
    if (polygon) {
        centerOnPolygon();
    }
});

const defaultCoords = [
    [59, 31],
    [59, 29],
    [60, 29],
    [60, 31],
    [59, 31]
];

polygon = L.polygon(defaultCoords, {
    color: '#306bff',
    weight: 3,
    fillColor: '#84a7fe',
    fillOpacity: 0.3
}).addTo(map);

polygon.on('click', function() {
    updateInfo();
});

createDragMarkers();

updateInfo();
setTimeout(centerOnPolygon, 300);