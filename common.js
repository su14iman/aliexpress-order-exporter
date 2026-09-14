const CSV_HEADER = "orderId,itemId,Product,Date,Unit Price,Quantity,Price,Store Name,SKU, InvoiceURL,ImageUrl";

function renderOrderTable(tbodyId, data) {
    const tableBody = document.getElementById(tbodyId);
    tableBody.innerHTML = '';

    if (!data || data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="12" class="loading-text">No data found. Click "Fetch Data" to start...</td></tr>';
        return;
    }

    data.forEach((order, index) => {
        tableBody.innerHTML += `
            <tr>
                <td><input type="checkbox" class="row-check" data-index="${index}" checked></td>
                <td><span class="badge">${index + 1}</span></td>
                <td>
                    ${order.imageUrl ?
                        `<img src="${order.imageUrl}" class="img-preview" alt="product">` :
                        '<span>-</span>'}
                </td>
                <td style="font-weight: bold;">${order.orderId}</td>
                <td>${order.itemId}</td>
                <td>${order.storeName}</td>
                <td class="product-cell" title="${order.title}">
                    <div style="font-weight: 500;">${(order.title || '').substring(0, 35)}...</div>
                    <span class="sku-text">Detail: ${order.sku || 'N/A'}</span>
                </td>
                <td>${order.date}</td>
                <td style="color: #666;">${order.unitPrice}</td>
                <td><span class="badge">x${order.quantity}</span></td>
                <td style="font-weight: bold; color: #ff4747;">${order.price}</td>
                <td>
                    <a href="${order.detailsLink}" target="_blank" class="invoice-link">
                        📄 Open
                    </a>
                </td>
            </tr>`;
    });
}

function getSelectedData(data) {
    const checks = document.querySelectorAll('.row-check');
    const selected = [];
    checks.forEach(chk => {
        if (chk.checked) selected.push(data[parseInt(chk.dataset.index, 10)]);
    });
    return selected;
}

function setupSelectAll(selectAllId) {
    const selectAll = document.getElementById(selectAllId);
    if (!selectAll) return;
    selectAll.addEventListener('change', () => {
        document.querySelectorAll('.row-check').forEach(chk => {
            chk.checked = selectAll.checked;
        });
    });
}

function buildCsv(data) {
    let csvContent = `data:text/csv;charset=utf-8,${CSV_HEADER}\n`;
    data.forEach(row => {
        csvContent += `"${row.orderId}","${row.itemId}","${row.title}","${row.date}","${row.unitPrice}","${row.quantity}","${row.price}","${row.storeName}","${row.sku}","${row.detailsLink}","${row.imageUrl}"\n`;
    });
    return csvContent;
}

function downloadCsv(data) {
    if (!data || data.length === 0) {
        alert("Select at least one item to export.");
        return;
    }
    const encodedUri = encodeURI(buildCsv(data));
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `AliExpress_Orders_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function initImageLightbox() {
    let overlay = document.getElementById('imgLightbox');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'imgLightbox';
        overlay.className = 'lightbox-overlay';
        overlay.innerHTML = '<img class="lightbox-img" alt="preview">';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', () => overlay.classList.remove('open'));
    }

    document.body.addEventListener('click', (e) => {
        const img = e.target.closest('.img-preview');
        if (!img) return;
        overlay.querySelector('.lightbox-img').src = img.src;
        overlay.classList.add('open');
    });
}
