let map = L.map('map').setView([55.76, 37.64], 6);
let drawnItems = new L.FeatureGroup();
let gridLayer = null;
let selectedRegion = null;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
    draw: {
        polygon: {
            allowIntersection: false,
            showArea: true,
            shapeOptions: {
                color: '#3498db',
                weight: 2
            }
        },
        rectangle: true,
        circle: false,
        marker: false,
        polyline: false,
        circlemarker: false
    },
    edit: {
        featureGroup: drawnItems,
        remove: true
    }
});

map.on('draw:created', function(e) {
    const layer = e.layer;
    drawnItems.clearLayers();
    drawnItems.addLayer(layer);
    selectedRegion = layer.toGeoJSON();
    
    // Автоматически определяем UTM зону
    if (document.getElementById('projectionSelect').value === 'utm') {
        const center = layer.getBounds().getCenter();
        const zone = Math.floor((center.lng + 180) / 6) + 1;
        document.getElementById('projectionSelect').dataset.utmZone = zone;
    }
    
    updateStatus('Регион выбран');
});

// Поиск региона через Nominatim
document.getElementById('searchRegionBtn').addEventListener('click', function() {
    const searchInput = document.getElementById('regionSearch');
    searchInput.style.display = searchInput.style.display === 'none' ? 'block' : 'none';
    if (searchInput.style.display === 'block') {
        searchInput.focus();
    }
});

document.getElementById('regionSearch').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const query = this.value;
        if (!query) return;
        
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&polygon_geojson=1&limit=1`)
            .then(res => res.json())
            .then(data => {
                if (data.length === 0) {
                    alert('Регион не найден');
                    return;
                }
                
                const result = data[0];
                const geojson = result.geojson;
                
                // Очищаем старые слои
                drawnItems.clearLayers();
                
                // Добавляем полигон
                const layer = L.geoJSON(geojson, {
                    style: {
                        color: '#3498db',
                        weight: 2,
                        fillOpacity: 0.2
                    }
                }).addTo(map);
                
                selectedRegion = geojson;
                map.fitBounds(layer.getBounds());
                
                document.getElementById('regionSearch').style.display = 'none';
                document.getElementById('regionSearch').value = '';
                updateStatus(`Найден: ${result.display_name}`);
            })
            .catch(err => {
                alert('Ошибка поиска: ' + err.message);
            });
    }
});

document.getElementById('generateGridBtn').addEventListener('click', function() {
    if (!selectedRegion) {
        alert('Сначала выберите область на карте');
        return;
    }
    
    const gridSize = parseInt(document.getElementById('gridSize').value) * 1000; // в метрах
    
    try {
        const grid = turf.squareGrid(selectedRegion, gridSize, {
            units: 'meters'
        });
        
        if (gridLayer) {
            map.removeLayer(gridLayer);
        }
        
        gridLayer = L.geoJSON(grid, {
            style: {
                color: '#e74c3c',
                weight: 1,
                fillOpacity: 0.1
            }
        }).addTo(map);
        
        updateStatus(`Сетка сгенерирована (${grid.features.length} ячеек)`);
        
    } catch(err) {
        alert('Ошибка генерации сетки: ' + err.message);
    }
});

document.getElementById('projectionSelect').addEventListener('change', function() {
    const projection = this.value;
    let projDef;
    
    switch(projection) {
        case 'mercator':
            projDef = '+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs';
            break;
        case 'utm':
            const zone = this.dataset.utmZone || 37; // по умолчанию для Москвы
            projDef = `+proj=utm +zone=${zone} +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;
            break;
        case 'albers':
            projDef = '+proj=aea +lat_1=20 +lat_2=60 +lat_0=40 +lon_0=90 +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs';
            break;
        case 'lambert':
            projDef = '+proj=lcc +lat_1=20 +lat_2=60 +lat_0=40 +lon_0=90 +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs';
            break;
    }
    
    try {
        proj4.defs('custom', projDef);
        updateStatus(`Проекция изменена: ${projection}`);
    } catch(err) {
        alert('Ошибка смены проекции: ' + err.message);
    }
});

function updateStatus(message) {
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 9999;
        animation: fadeIn 0.3s;
    `;
    statusDiv.textContent = message;
    document.body.appendChild(statusDiv);
    
    setTimeout(() => {
        statusDiv.style.opacity = '0';
        statusDiv.style.transition = 'opacity 0.5s';
        setTimeout(() => statusDiv.remove(), 500);
    }, 3000);
}

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(style);