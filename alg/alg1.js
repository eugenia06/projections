const map = L.map('map').setView([55.75, 37.61], 10);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);
const defaultCoords = [
    [55.75, 37.61],
    [55.76, 37.62],
    [55.74, 37.63],
    [55.73, 37.61],
    [55.75, 37.61]
];

let polygon = L.polygon(defaultCoords, {
    color: '#d32f2f',
    weight: 3,
    fillColor: '#ff6b6b',
    fillOpacity: 0.3
}).addTo(map);

polygon.bindPopup('🟥 Мой полигон');

function centerOnPolygon() {
    if (polygon) {
        map.fitBounds(polygon.getBounds(), {
            padding: [50, 50],
            maxZoom: 18,
            duration: 1 
        });
    }
}

setTimeout(centerOnPolygon, 200);

document.getElementById('fitBoundsBtn').addEventListener('click', centerOnPolygon);
let drawControl = null;
let isEditing = false;
let editableLayers = null;

function startEditing() {
    if (!polygon) return;
    
    if (drawControl) {
        map.removeControl(drawControl);
    }

    if (!editableLayers) {
        editableLayers = new L.FeatureGroup().addTo(map);
    }
    editableLayers.clearLayers();
    editableLayers.addLayer(polygon);
    
    drawControl = new L.Control.Draw({
        edit: {
            featureGroup: editableLayers,
            poly: {
                allowIntersection: false
            }
        },
        draw: false 
    });
    
    map.addControl(drawControl);
    isEditing = true;
    document.getElementById('editBtn').style.display = 'none';
    document.getElementById('saveBtn').style.display = 'inline-block';
    document.getElementById('cancelBtn').style.display = 'inline-block';
    
    map.on('draw:editstop', updateInfo);
}

function saveEditing() {
    if (drawControl) {
        map.removeControl(drawControl);
        drawControl = null;
    }
    
    if (editableLayers && editableLayers.getLayers().length > 0) {
        polygon = editableLayers.getLayers()[0];
        polygon.bindPopup('🟥 Мой полигон (отредактирован)');
    }
    
    isEditing = false;
    
    document.getElementById('editBtn').style.display = 'inline-block';
    document.getElementById('saveBtn').style.display = 'none';
    document.getElementById('cancelBtn').style.display = 'none';
    
    updateInfo();
}

function cancelEditing() {
    if (drawControl) {
        map.removeControl(drawControl);
        drawControl = null;
    }
    
    if (editableLayers) {
        editableLayers.clearLayers();
        polygon.addTo(map);
    }
    
    isEditing = false;
    
    document.getElementById('editBtn').style.display = 'inline-block';
    document.getElementById('saveBtn').style.display = 'none';
    document.getElementById('cancelBtn').style.display = 'none';
    
    updateInfo();
}

document.getElementById('editBtn').addEventListener('click', startEditing);
document.getElementById('saveBtn').addEventListener('click', saveEditing);
document.getElementById('cancelBtn').addEventListener('click', cancelEditing);


document.getElementById('deleteBtn').addEventListener('click', function() {
    if (polygon && confirm('Удалить полигон?')) {
        map.removeLayer(polygon);
        polygon = null;
        document.getElementById('pointCount').textContent = '0';
        document.getElementById('area').textContent = '0';
        document.getElementById('center').textContent = '—';
        this.disabled = true;
    }
});

document.getElementById('addPointBtn').addEventListener('click', function() {
    if (!polygon) {
        alert('Сначала создайте полигон!');
        return;
    }
    

    const coords = polygon.getLatLngs()[0];
    const last = coords[coords.length - 2] || coords[coords.length - 1];

    const newPoint = [
        last.lat + 0.005,
        last.lng + 0.005
    ];
    
    coords.splice(coords.length - 1, 0, newPoint);
    
    map.removeLayer(polygon);
    polygon = L.polygon(coords, {
        color: '#d32f2f',
        weight: 3,
        fillColor: '#ff6b6b',
        fillOpacity: 0.3
    }).addTo(map);
    polygon.bindPopup('🟥 Мой полигон (добавлена точка)');
    
    updateInfo();
    centerOnPolygon();
});


function updateInfo() {
    if (!polygon) return;
    
    const coords = polygon.getLatLngs()[0];
    const count = coords.length - 1; 
    
    document.getElementById('pointCount').textContent = count;
    
    const area = L.GeometryUtil.geodesicArea(coords) / 1000000;
    document.getElementById('area').textContent = area.toFixed(2);
    
    const center = polygon.getBounds().getCenter();
    document.getElementById('center').textContent = 
        `${center.lat.toFixed(4)}°, ${center.lng.toFixed(4)}°`;
}

window.addEventListener('resize', function() {
    if (polygon) {
        centerOnPolygon();
    }
});

polygon.on('click', function() {
    updateInfo();
});
updateInfo();

console.log('✅ Карта готова!');
console.log('💡 Управление:');
console.log('  • Центрировать — кнопка в правом верхнем углу');
console.log('  • Редактировать — кнопка "Редактировать"');
console.log('  • Добавить точку — кнопка "Добавить точку"');
console.log('  • Удалить — кнопка "Удалить полигон"');