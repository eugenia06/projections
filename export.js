document.getElementById('exportSVG').addEventListener('click', function() {
    if (!gridLayer) {
        alert('Сначала сгенерируйте сетку');
        return;
    }
    
    const bounds = map.getBounds();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="${bounds.getWest()} ${bounds.getSouth()} ${bounds.getEast() - bounds.getWest()} ${bounds.getNorth() - bounds.getSouth()}">
        ${generateSVGContent()}
    </svg>`;
    
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    saveAs(blob, 'grid.svg');
});

document.getElementById('exportPNG').addEventListener('click', function() {
    const mapContainer = document.getElementById('map');
    html2canvas(mapContainer, {
        useCORS: true,
        scale: 2
    }).then(canvas => {
        canvas.toBlob(blob => {
            saveAs(blob, 'grid.png');
        });
    });
});

document.getElementById('exportPDF').addEventListener('click', function() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');
    const mapContainer = document.getElementById('map');
    
    html2canvas(mapContainer, {
        useCORS: true,
        scale: 2
    }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        doc.addImage(imgData, 'PNG', 10, 10, 280, 190);
        doc.save('grid.pdf');
    });
});

document.getElementById('exportSHP').addEventListener('click', function() {
    if (!gridLayer) {
        alert('Сначала сгенерируйте сетку');
        return;
    }
    const geojson = gridLayer.toGeoJSON();
    const shpData = shpwrite.download(geojson, {
        outputType: 'shp',
        compression: 'STORE'
    });

    const blob = new Blob([shpData], { type: 'application/zip' });
    saveAs(blob, 'grid.zip');
});

function generateSVGContent() {
    if (!gridLayer) return '';
    
    const geojson = gridLayer.toGeoJSON();
    let svgContent = '';
    geojson.features.forEach(feature => {
        const coords = feature.geometry.coordinates[0];
        const points = coords.map(c => `${c[0]},${c[1]}`).join(' ');
        svgContent += `<polygon points="${points}" fill="none" stroke="red" stroke-width="1"/>`;
    });
    
    return svgContent;
}