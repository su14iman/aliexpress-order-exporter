chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchTitle") {
        fetch(request.url)
        .then((response) => response.text())
        .then((html) => {
            // 1. Try to find og:title (the title used for social media, which is always in English)
            let match = html.match(
                /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i,
            );

            // 2. If og:title is not found, try the regular <title> tag (which may be in German)
            if (!match) {
                match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            }

            if (match && match[1]) {
                // Clean the title from extra symbols and site name
                let title = match[1]
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, "&")
                    .replace("- AliExpress", "")
                    .trim();
                sendResponse({ title: title });
            } else {
                sendResponse({ title: "Title Not Found" });
            }
        })
        .catch((err) => sendResponse({ title: "Fetch Error" }));
        return true;
    }

    if (request.action === "downloadInvoices") {
        downloadInvoicesSequentially(request.orders || []);
        sendResponse({ started: true });
        return false;
    }
});

// The invoice page (tax-ui) is a client-rendered React app, so a plain fetch()
// only returns the empty shell + JS bundle. We open it in a real (hidden) tab,
// wait for it to render, then use the debugger protocol to print it to PDF.
function notifyProgress(payload) {
    chrome.runtime.sendMessage({ action: "invoiceProgress", payload }).catch(() => {});
}

function waitForTabComplete(tabId) {
    return new Promise((resolve) => {
        function listener(id, info) {
            if (id === tabId && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function navigateTab(tabId, url) {
    const done = waitForTabComplete(tabId);
    await chrome.tabs.update(tabId, { url });
    await done;
}

async function waitForInvoiceRender(tabId, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        let hasContent = false;
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const root = document.getElementById("root");
                    return !!(root && root.innerText && root.innerText.trim().length > 50);
                }
            });
            hasContent = !!(results && results[0] && results[0].result);
        } catch (err) {
            hasContent = false;
        }
        if (hasContent) {
            // give fonts/images a moment to settle before printing
            await new Promise((r) => setTimeout(r, 600));
            return true;
        }
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

// --- Minimal dependency-free ZIP writer (stored/uncompressed entries) ---
function crc32(bytes) {
    let table = crc32._table;
    if (!table) {
        table = crc32._table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(entries) {
    const encoder = new TextEncoder();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name);
        const data = entry.data;
        const crc = crc32(data);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0, true);
        lv.setUint16(8, 0, true); // stored (no compression)
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);
        localChunks.push(localHeader, data);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);
        centralChunks.push(centralHeader);

        offset += localHeader.length + data.length;
    }

    const centralDirOffset = offset;
    const centralDirSize = centralChunks.reduce((sum, c) => sum + c.length, 0);

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralDirSize, true);
    ev.setUint32(16, centralDirOffset, true);

    const allChunks = [...localChunks, ...centralChunks, eocd];
    const totalLength = allChunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of allChunks) {
        result.set(chunk, pos);
        pos += chunk.length;
    }
    return result;
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}
// --- end ZIP writer ---

async function downloadInvoicesSequentially(orders) {
    const total = orders.length;
    if (total === 0) return;

    let tab;
    const zipEntries = [];
    try {
        tab = await chrome.tabs.create({ url: "about:blank", active: false });
        await chrome.debugger.attach({ tabId: tab.id }, "1.3");

        for (let i = 0; i < total; i++) {
            const order = orders[i];
            try {
                notifyProgress({ index: i, total, orderId: order.orderId, status: "opening" });
                await navigateTab(tab.id, order.detailsLink);
                await waitForInvoiceRender(tab.id);

                notifyProgress({ index: i, total, orderId: order.orderId, status: "printing" });
                const { data } = await chrome.debugger.sendCommand(
                    { tabId: tab.id },
                    "Page.printToPDF",
                    { printBackground: true, preferCSSPageSize: true }
                );

                zipEntries.push({
                    name: `Invoice_${order.orderId || i + 1}.pdf`,
                    data: base64ToUint8Array(data)
                });

                notifyProgress({ index: i, total, orderId: order.orderId, status: "done" });
            } catch (err) {
                notifyProgress({ index: i, total, orderId: order.orderId, status: "error", error: err.message });
            }
        }

        if (zipEntries.length > 0) {
            notifyProgress({ index: total, total, status: "zipping" });
            const zipBytes = createZip(zipEntries);
            const dateStamp = new Date().toISOString().slice(0, 10);

            await chrome.downloads.download({
                url: `data:application/zip;base64,${uint8ArrayToBase64(zipBytes)}`,
                filename: `AliExpress_Invoices_${dateStamp}.zip`,
                saveAs: false,
                conflictAction: "uniquify"
            });
        }
    } catch (err) {
        notifyProgress({ index: total, total, status: "error", error: err.message });
    } finally {
        if (tab) {
            await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
            await chrome.tabs.remove(tab.id).catch(() => {});
        }
        notifyProgress({ index: total, total, status: "finished" });
    }
}
