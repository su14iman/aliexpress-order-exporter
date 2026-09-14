let extractedData = [];

setupSelectAll('selectAll');
initImageLightbox();

chrome.storage.local.get('extractedData', (result) => {
    extractedData = result.extractedData || [];
    renderOrderTable('orderTable', extractedData);
});

document.getElementById('downloadCSV').addEventListener('click', () => {
    if (extractedData.length === 0) return alert("No data found. Fetch data from the popup first.");
    downloadCsv(getSelectedData(extractedData));
});
