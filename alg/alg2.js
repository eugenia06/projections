fetch('data.json')
  .then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
  })
  .then(products => {
      let placeholder = document.querySelector('#data-output');
      let out = "";
      for (let product of Object.values(products)) {
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
      }
      placeholder.innerHTML = out;
  })
.catch(function(error){
    console.error('Ошибка загрузки данных:', error);
});