// This script will handle the browser action, storage, and tab updates.
console.log("Background script loaded.");

chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'get_new_title_prompt' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Could not communicate with content script. It might not be injected yet. Try reloading the page.", chrome.runtime.lastError);
            return;
        }

        if (response && response.newTitle !== null) { // User didn't cancel prompt
            const newTitle = response.newTitle.trim();
            if (newTitle) {
                // Set the custom title
                chrome.storage.local.get('tabTitles', (data) => {
                    const tabTitles = data.tabTitles || {};
                    tabTitles[tab.id] = { title: newTitle, url: tab.url };
                    chrome.storage.local.set({ tabTitles }, () => {
                        // Tell the content script to enforce this new title
                        chrome.tabs.sendMessage(tab.id, { type: 'set_custom_title', title: newTitle });
                    });
                });
            } else {
                // Remove the custom title
                chrome.storage.local.get('tabTitles', (data) => {
                    const tabTitles = data.tabTitles || {};
                    delete tabTitles[tab.id];
                    chrome.storage.local.set({ tabTitles }, () => {
                        // Tell the content script to stop enforcing a custom title
                        chrome.tabs.sendMessage(tab.id, { type: 'remove_custom_title' });
                    });
                });
            }
        }
    });
});

// --- Tab Lifecycle Listeners ---

// Function to apply a custom title when a tab loads or is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Apply title on load
    if (changeInfo.status === 'loading') {
        chrome.storage.local.get('tabTitles', (data) => {
            const tabTitles = data.tabTitles || {};
            if (tabTitles[tabId]) {
                const customTitle = tabTitles[tabId].title;
                chrome.tabs.sendMessage(tabId, { type: 'set_custom_title', title: customTitle }, () => {
                    if (chrome.runtime.lastError) { /* Ignore errors, script may not be ready */ }
                });
            }
        });
    }

    // Update URL if it changes for a tab with a custom title
    if (changeInfo.url) {
        chrome.storage.local.get('tabTitles', (data) => {
            const tabTitles = data.tabTitles || {};
            if (tabTitles[tabId]) {
                tabTitles[tabId].url = changeInfo.url;
                chrome.storage.local.set({ tabTitles });
            }
        });
    }
});

// Clean up storage when a tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    chrome.storage.local.get('tabTitles', (data) => {
        const tabTitles = data.tabTitles || {};
        if (tabTitles[tabId]) {
            delete tabTitles[tabId];
            chrome.storage.local.set({ tabTitles });
        }
    });
});

// --- Browser Lifecycle Listeners ---

// Recover titles on browser startup
chrome.runtime.onStartup.addListener(() => {
    console.log("Browser starting up. Restoring custom tab titles.");
    chrome.storage.local.get('tabTitles', (data) => {
        const oldTabTitles = data.tabTitles || {};
        if (Object.keys(oldTabTitles).length === 0) return;

        const urlToRecord = {};
        for (const tabId in oldTabTitles) {
            const record = oldTabTitles[tabId];
            if (!urlToRecord[record.url]) {
                urlToRecord[record.url] = record;
            }
        }

        chrome.tabs.query({}, (tabs) => {
            const newTabTitles = {};
            for (const tab of tabs) {
                const record = urlToRecord[tab.url];
                if (record) {
                    newTabTitles[tab.id] = { title: record.title, url: tab.url };
                    chrome.tabs.sendMessage(tab.id, { type: 'set_custom_title', title: record.title }, () => {
                        if (chrome.runtime.lastError) { /* Ignore errors */ }
                    });
                    delete urlToRecord[tab.url]; // Prevent re-use for same URL
                }
            }
            // Overwrite old records with the newly mapped ones
            chrome.storage.local.set({ tabTitles: newTabTitles });
        });
    });
});
