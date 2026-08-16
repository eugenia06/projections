// 1. Создаём карту
const map = L.map('map').setView([55.75, 37.61], 10);

// 2. Добавляем тайлы (подложку)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

// Включаем рисование на карте
let drawing = false;
let points = [];

map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    
    points.push([lat, lng]);
    
    // Если нажали 4 раза — создаём полигон
    if (points.length === 4) {
        // Добавляем первую точку для замыкания
        points.push(points[0]);
        
        const polygon = L.polygon(points, {
            color: '#d32f2f',
            weight: 3,
            fillColor: '#ff6b6b',
            fillOpacity: 0.3
        }).addTo(map);
        
        map.fitBounds(polygon.getBounds(), {
            padding: [50, 50]
        });
        
        polygon.bindPopup('Новый полигон!');
        
        // Сбрасываем для нового рисования
        points = [];
    }
});

// Добавим подсказку
map.on('click', function() {
    if (points.length === 0) {
        console.log('Кликните 4 раза, чтобы создать полигон');
    }
});

const polygon = L.polygon(polygonCoords, {
    color: '#d32f2f',      // красный контур
    weight: 3,             // толщина линии
    fillColor: '#ff6b6b',  // заливка
    fillOpacity: 0.3       // прозрачность заливки
}).addTo(map);

// 4. Настраиваем карту под полигон
map.fitBounds(polygon.getBounds(), {
    padding: [50, 50]      // отступы от краёв
});

// 5. Добавляем всплывающую подсказку
polygon.bindPopup('Это мой полигон! 🗺️');

// 6. (Опционально) Показываем координаты в консоли
console.log('Границы полигона:');
console.log('Север:', polygon.getBounds().getNorth());
console.log('Юг:', polygon.getBounds().getSouth());
console.log('Восток:', polygon.getBounds().getEast());
console.log('Запад:', polygon.getBounds().getWest());