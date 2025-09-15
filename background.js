// --- Global Variables ---
let tabTitlesCache = {};

// --- Initialization ---

// Helper function to load titles from storage into the cache. Returns a promise.
const loadTitlesToCache = () => {
    return new Promise((resolve) => {
        chrome.storage.local.get('tabTitles', (data) => {
            tabTitlesCache = data.tabTitles || {};
            console.log('Tab titles loaded into cache.');
            resolve();
        });
    });
};

// Load cache when the extension is installed or updated
chrome.runtime.onInstalled.addListener(loadTitlesToCache);

// Load cache and re-map titles on browser startup
chrome.runtime.onStartup.addListener(async () => {
    console.log("Browser starting up. Restoring custom tab titles.");
    await loadTitlesToCache();

    const oldTabTitles = { ...tabTitlesCache };
    if (Object.keys(oldTabTitles).length === 0) return;

    const urlToRecord = {};
    for (const tabId in oldTabTitles) {
        const record = oldTabTitles[tabId];
        urlToRecord[record.url] = record; // Last one wins for duplicate URLs
    }

    chrome.tabs.query({}, (tabs) => {
        const newTabTitles = {};
        for (const tab of tabs) {
            const record = urlToRecord[tab.url];
            if (record) {
                // Match found: create a new record with the new tab ID
                newTabTitles[tab.id] = { title: record.title, url: tab.url };
                // Apply the title to the tab
                chrome.tabs.sendMessage(tab.id, { type: 'set_custom_title', title: record.title }, () => {
                    if (chrome.runtime.lastError) { /* ignore, cs may not be ready */ }
                });
                delete urlToRecord[tab.url]; // Prevent re-use for other tabs with same URL
            }
        }
        // Replace the old cache and storage with the new, correct mappings
        tabTitlesCache = newTabTitles;
        chrome.storage.local.set({ tabTitles: tabTitlesCache });
        console.log("Finished re-mapping tab titles.");
    });
});


// --- Action Handler ---
chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'get_new_title_prompt' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Could not communicate with content script.", chrome.runtime.lastError);
            return;
        }

        if (response && response.newTitle !== null) {
            const newTitle = response.newTitle.trim();
            if (newTitle) {
                // Set the custom title in cache and storage
                tabTitlesCache[tab.id] = { title: newTitle, url: tab.url };
                chrome.storage.local.set({ tabTitles: tabTitlesCache }, () => {
                    chrome.tabs.sendMessage(tab.id, { type: 'set_custom_title', title: newTitle });
                });
            } else {
                // Remove the custom title from cache and storage
                delete tabTitlesCache[tab.id];
                chrome.storage.local.set({ tabTitles: tabTitlesCache }, () => {
                    chrome.tabs.sendMessage(tab.id, { type: 'remove_custom_title' });
                });
            }
        }
    });
});

// --- Tab Lifecycle Listeners ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const customTitleRecord = tabTitlesCache[tabId];
    if (!customTitleRecord) {
        return; // This tab doesn't have a custom title, so we don't care about it.
    }

    // Helper function to apply the title
    const applyTitle = () => {
        chrome.tabs.sendMessage(tabId, { type: 'set_custom_title', title: customTitleRecord.title }, () => {
            if (chrome.runtime.lastError) { /* Ignored, as script may not be ready */ }
        });
    };

    // --- Trigger title application at multiple points for robustness ---

    // 1. When the tab starts loading
    if (changeInfo.status === 'loading') {
        applyTitle();
    }

    // 2. When the tab has finished loading
    if (changeInfo.status === 'complete') {
        applyTitle();
    }

    // 3. When the page's title changes to something else
    if (changeInfo.title && changeInfo.title !== customTitleRecord.title) {
        applyTitle();
    }

    // --- Handle URL changes for persistence ---
    if (changeInfo.url) {
        tabTitlesCache[tabId].url = changeInfo.url;
        chrome.storage.local.set({ tabTitles: tabTitlesCache });
    }
});

// Clean up storage and cache when a tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (tabTitlesCache[tabId]) {
        delete tabTitlesCache[tabId];
        chrome.storage.local.set({ tabTitles: tabTitlesCache });
    }
});
