let extractedData = [];

setupSelectAll('selectAll');
initImageLightbox();
setupInvoiceProgressListener('invoiceStatus');

document.getElementById('extract').addEventListener('click', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeBasicInfo
    }, async (results) => {
        if (results && results[0].result) {
            const basicOrders = results[0].result;
            const tableBody = document.getElementById('orderTable');
            tableBody.innerHTML = '<tr><td colspan="12">Fetching English titles...</td></tr>';

            extractedData = [];

            for (let order of basicOrders) {
                // Request the title from the background to bypass CORS
                const response = await chrome.runtime.sendMessage({
                    action: "fetchTitle",
                    url: order.productLink
                });
                order.title = response.title || "No Title";
                extractedData.push(order);

                // Update the table immediately after each order is processed
                renderOrderTable('orderTable', extractedData);
                chrome.storage.local.set({ extractedData });
            }
        }
    });
});

// Function to scrape basic order info (date, price, links) from the AliExpress orders page
function scrapeBasicInfo() {
    const monthsMap = {
        'Jan': '01', 'Feb': '02', 'Mär': '03', 'Apr': '04',
        'Mai': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Okt': '10', 'Nov': '11', 'Dez': '12'
    };

    return Array.from(document.querySelectorAll('.order-item')).map(item => {
        // Extract the date and order ID from the header info
        const infoContainer = item.querySelector('.order-item-header-right-info');
        let formattedDate = "N/A";
        let orderId = "";

        if (infoContainer) {
            const lines = infoContainer.querySelectorAll('div');
            // First line contains the date, e.g. "Bestelldatum: 12. Mär 2024"
            const dateText = lines[0]?.innerText || "";
            if (dateText.includes(':')) {
                const datePart = dateText.split(':')[1].trim();
                const parts = datePart.replace('.', '').split(' ');
                if (parts.length === 3) {
                    const month = monthsMap[parts[1]] || parts[1];
                    formattedDate = `${parts[0].padStart(2, '0')}.${month}.${parts[2]}`;
                }
            }
            // Second line contains the order ID, e.g. "Bestellnummer: 1234567890"
            const idText = lines[1]?.innerText || "";
            const idMatch = idText.match(/\d+/);
            if (idMatch) orderId = idMatch[0];
        }

        // 2. Build the direct invoice link (inside the iframe)
        const directInvoiceLink = orderId ?
            `https://www.aliexpress.com/p/tax-ui/index.html?isGrayMatch=false&orderId=${orderId}` :
            "#";

        // 3. get Image
        const imageStyle = item.querySelector('.order-item-content-img')?.style.backgroundImage || "";
        const imageUrlMatch = imageStyle.match(/url\("?(.*?)"?\)/);
        const imageUrl = imageUrlMatch ? imageUrlMatch[1] : "";

        // 4. get single price and quantity (if available) - .order-item-content-info-number
        const numberContainer = item.querySelector('.order-item-content-info-number');
        let unitPrice = "0";
        let quantity = "1";
        if (numberContainer) {
            const qEl = numberContainer.querySelector('.order-item-content-info-number-quantity');
            if (qEl) quantity = qEl.innerText.replace('x', '').trim();

            const priceWrap = numberContainer.querySelector('[class*="es--wrap"]');
            if (priceWrap) {
                unitPrice = priceWrap.innerText.replace(/€|\s/g, '').replace(',', '.').trim();
            }
        }

        // 5. Extract store name (optional, for better context) - .order-item-store-name span
        const storeNameEl = item.querySelector('.order-item-store-name span');
        const storeName = storeNameEl ? storeNameEl.innerText.trim() : "Unknown Store";

        // 6. Extract SKU or product options (optional, for better context) - .order-item-content-info-sku
        const skuEl = item.querySelector('.order-item-content-info-sku');
        const sku = skuEl ? skuEl.innerText.trim() : "";

        // 7. Product link - .order-item-content-body a
        const productLinkEl = item.querySelector('.order-item-content-body a');
        const productLink = productLinkEl ? productLinkEl.href : "";

        // 8. ItemID
        let itemId = "";
        if (productLink) {
            const itemIdMatch = productLink.match(/item\/(\d+)\.html/);
            if (itemIdMatch && itemIdMatch[1]) {
                itemId = itemIdMatch[1];
            }
        }

        return {
            date: formattedDate,
            itemId: itemId,
            orderId: orderId,
            price: item.querySelector('.order-item-content-opt-price-total')?.innerText.replace(/Gesamt:|Insgesamt:|€/g, '').trim(),
            unitPrice: unitPrice,
            quantity: quantity,
            storeName: storeName,
            sku: sku,
            detailsLink: directInvoiceLink, // direct link to the invoice page (which contains the English title)
            productLink: productLink, // link to the product page (used to fetch the English title in the background)
            imageUrl: imageUrl
        };
    });
}

document.getElementById('downloadCSV').addEventListener('click', () => {
    if (extractedData.length === 0) return alert("Get the orders first by clicking 'Extract Orders'.");
    downloadCsv(getSelectedData(extractedData));
});

document.getElementById('downloadInvoices').addEventListener('click', () => {
    if (extractedData.length === 0) return alert("Get the orders first by clicking 'Extract Orders'.");
    requestInvoiceDownload(getSelectedData(extractedData));
});

document.getElementById('openFullPage').addEventListener('click', async () => {
    await chrome.storage.local.set({ extractedData });
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
});
