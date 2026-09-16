let allData = [];
let sortColumn = -1;
let sortDir = 1;
let appliedFilters = {
  ellipsoid: "",
  mathModel: "",
  primenenie: "",
  place: ""
};

fetch('data.json')
  .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
  })
  .then(products => {
      allData = Object.values(products);
      renderTable(allData);
      fillFilterOptions(allData);
  })
  .catch(function(error){
      console.error('Ошибка загрузки данных:', error);
  });


function renderTable(data) {
  const tbody = document.getElementById('data-output');
  let out = "";

  data.forEach(product => {
    out += `
      <tr>
        <td>${product.code}</td>
        <td>${product.source}:${product.code}</td>
        <td>${product.name}</td>
        <td>${product.ellipsoid[0]}</td>
        <td>${product.MathModel}</td>
        <td>${product.Primenenie}</td>
        <td>${product.Place}</td>
      </tr>
    `;
  });

  tbody.innerHTML = out;
}


function fillFilterOptions(data) {
  const columns = {
    filterEllipsoid:  p => p.ellipsoid[0],
    filterMathModel:  p => p.MathModel,
    filterPrimenenie: p => p.Primenenie,
    filterPlace:      p => p.Place
  };

  for (const [selectId, getter] of Object.entries(columns)) {
    const select = document.getElementById(selectId);
    const values = new Set();

    data.forEach(item => {
      const val = getter(item);
      if (val) values.add(val);
    });

    [...values].sort((a, b) => a.localeCompare(b, 'ru')).forEach(val => {
      const option = document.createElement('option');
      option.value = val;
      option.textContent = val;
      select.appendChild(option);
    });
  }
}


function applyFilters() {
  appliedFilters.ellipsoid  = document.getElementById("filterEllipsoid").value;
  appliedFilters.mathModel  = document.getElementById("filterMathModel").value;
  appliedFilters.primenenie = document.getElementById("filterPrimenenie").value;
  appliedFilters.place      = document.getElementById("filterPlace").value;

  doFilter();
}


function onSearchInput() {
  doFilter();
}


function doFilter() {
  const search = document.getElementById("myInput").value.toUpperCase();

  const filtered = allData.filter(product => {
    if (search) {
      const haystack = [
        product.code,
        product.source + ":" + product.code,
        product.name,
        product.ellipsoid[0],
        product.MathModel,
        product.Primenenie,
        product.Place
      ].join(" ").toUpperCase();

      if (haystack.indexOf(search) === -1) return false;
    }

    if (appliedFilters.ellipsoid  && product.ellipsoid[0] !== appliedFilters.ellipsoid)  return false;
    if (appliedFilters.mathModel  && product.MathModel    !== appliedFilters.mathModel)  return false;
    if (appliedFilters.primenenie && product.Primenenie   !== appliedFilters.primenenie) return false;
    if (appliedFilters.place      && product.Place        !== appliedFilters.place)      return false;

    return true;
  });

  renderTable(sortData(filtered));
}


function sortData(data) {
  if (sortColumn === -1) return data;

  const keys = ['code', 'fullCode', 'name', 'ellipsoid', 'MathModel', 'Primenenie', 'Place'];

  return [...data].sort((a, b) => {
    const getVal = (item) => {
      if (sortColumn === 1) return item.source + ":" + item.code;
      if (sortColumn === 3) return item.ellipsoid[0];
      return item[keys[sortColumn]];
    };

    const aText = String(getVal(a) ?? "").trim();
    const bText = String(getVal(b) ?? "").trim();

    const aNum = parseFloat(aText);
    const bNum = parseFloat(bText);
    let cmp;

    if (!isNaN(aNum) && !isNaN(bNum)) {
      cmp = aNum - bNum;
    } else {
      cmp = aText.localeCompare(bText, 'ru');
    }

    return cmp * sortDir;
  });
}


// Клик по заголовку — сортировка
function sortTable(columnIndex) {
  if (sortColumn === columnIndex) {
    sortDir = -sortDir;
  } else {
    sortColumn = columnIndex;
    sortDir = 1;
  }

  updateSortArrows(columnIndex);
  doFilter();
}

function updateSortArrows(columnIndex) {
  const arrows = document.querySelectorAll('#myTable thead th .sort-arrow');
  arrows.forEach(a => a.textContent = '');
  if (arrows[columnIndex]) {
    arrows[columnIndex].textContent = sortDir === 1 ? ' ▲' : ' ▼';
  }
}


function resetFilters() {
  document.getElementById("myInput").value = "";
  document.getElementById("filterEllipsoid").value = "";
  document.getElementById("filterMathModel").value = "";
  document.getElementById("filterPrimenenie").value = "";
  document.getElementById("filterPlace").value = "";

  appliedFilters = {
    ellipsoid: "",
    mathModel: "",
    primenenie: "",
    place: ""
  };

  sortColumn = -1;
  sortDir = 1;
  updateSortArrows(-1);

  renderTable(allData);
}