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
});
