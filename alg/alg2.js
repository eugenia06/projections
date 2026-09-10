const table = new Table('#tableContainer', {
    data: myData,
    columns: [ 
    { name: 'name', title: 'Employee Name', sortable: true },
    { name: 'department', title: 'Department', sortable: true },
    { name: 'salary', title: 'Salary', sortType: 'number', format: 'currency', currency: 'USD' },
    { name: 'joinDate', title: 'Join Date', sortType: 'date', format: 'date' }
    ],
    pagination: {
    enabled: true,
    pageSize: 10
    },
    sorting: {
    enabled: true
    },
    filtering: {
    enabled: true
    },
    selection: {
    enabled: true,
    mode: 'multi',
    dataIdKey: 'id'
    }});