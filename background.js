// --- Global Variables ---
let tabTitlesCache = {};

// --- Initialization ---

// Helper function to load titles from storage into the cache. Returns a promise.
/** @returns {Promise<void>} */
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
  console.log('Browser starting up. Restoring custom tab titles.');
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
      if (record && typeof tab.id === 'number') {
        // Match found: create a new record with the new tab ID
        newTabTitles[tab.id] = { title: record.title, url: tab.url };
        // Apply the title to the tab
        chrome.tabs.sendMessage(
          tab.id,
          { type: 'set_custom_title', title: record.title },
          () => {
            if (chrome.runtime.lastError) {
              /* ignore, cs may not be ready */
            }
          },
        );
        delete urlToRecord[tab.url]; // Prevent re-use for other tabs with same URL
      }
    }
    // Replace the old cache and storage with the new, correct mappings
    tabTitlesCache = newTabTitles;
    chrome.storage.local.set({ tabTitles: tabTitlesCache });
    console.log('Finished re-mapping tab titles.');
  });
});

// --- Action Handler ---
const processNewTitleResponse = (tab, response) => {
  if (!tab || typeof tab.id !== 'number') {
    console.warn('No valid tab id to apply title changes.');
    return;
  }
  if (response && response.newTitle !== null) {
    const newTitle = response.newTitle.trim();
    if (newTitle) {
      // Set the custom title in cache and storage
      tabTitlesCache[tab.id] = { title: newTitle, url: tab.url };
      chrome.storage.local.set({ tabTitles: tabTitlesCache }, () => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'set_custom_title',
          title: newTitle,
        });
      });
    } else {
      // Remove the custom title from cache and storage
      delete tabTitlesCache[tab.id];
      chrome.storage.local.set({ tabTitles: tabTitlesCache }, () => {
        chrome.tabs.sendMessage(tab.id, { type: 'remove_custom_title' });
      });
    }
  }
};

const requestPromptForTab = (tab, hasReloaded = false) => {
  if (!tab || typeof tab.id !== 'number') {
    console.warn('No valid tab id to request prompt.');
    return;
  }
  chrome.tabs.sendMessage(
    tab.id,
    { type: 'get_new_title_prompt' },
    (response) => {
      if (chrome.runtime.lastError) {
        const message = String(
          chrome.runtime.lastError.message || chrome.runtime.lastError,
        );
        const noReceiver =
          message.includes('Receiving end does not exist') ||
          message.includes('Could not establish connection') ||
          message.includes('The message port closed') ||
          message.includes('No matching recipient') ||
          message.includes('Disconnected port');
        if (noReceiver && !hasReloaded) {
          console.warn(
            'Content script not injected. Reloading tab to inject content script.',
          );
          chrome.tabs.reload(tab.id, {}, () => {
            const onceListener = (updatedTabId, changeInfo, updatedTab) => {
              if (updatedTabId === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onceListener);
                chrome.tabs.get(tab.id, (freshTab) => {
                  requestPromptForTab(freshTab, true);
                });
              }
            };
            chrome.tabs.onUpdated.addListener(onceListener);
          });
        } else {
          console.error(
            'Could not communicate with content script.',
            chrome.runtime.lastError,
          );
        }
        return;
      }
      processNewTitleResponse(tab, response);
    },
  );
};

chrome.action.onClicked.addListener((tab) => {
  if (tab && typeof tab.id === 'number') {
    requestPromptForTab(tab);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (activeTab && typeof activeTab.id === 'number') {
        requestPromptForTab(activeTab);
      } else {
        console.warn('No active tab to handle action click.');
      }
    });
  }
});

// --- Tab Lifecycle Listeners ---

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // If cache is empty, it might be due to service worker restart. Load it.
  if (Object.keys(tabTitlesCache).length === 0) {
    await loadTitlesToCache();
  }
  const customTitleRecord = tabTitlesCache[tabId];
  if (!customTitleRecord) {
    return; // This tab doesn't have a custom title, so we don't care about it.
  }

  // Helper function to apply the title
  const applyTitle = () => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'set_custom_title', title: customTitleRecord.title },
      () => {
        if (chrome.runtime.lastError) {
          /* Ignored, as script may not be ready */
        }
      },
    );
  };

  // --- Trigger title application at multiple points for robustness ---

  // 1. When a discarded tab is reloaded, this is the first event fired.
  if (changeInfo.discarded === false) {
    applyTitle();
  }

  // 2. When the tab starts loading
  if (changeInfo.status === 'loading') {
    applyTitle();
  }

  // 3. When the tab has finished loading
  if (changeInfo.status === 'complete') {
    applyTitle();
  }

  // 4. When the page's title changes to something else
  if (changeInfo.title && changeInfo.title !== customTitleRecord.title) {
    applyTitle();
  }

  // --- Handle URL changes for persistence ---
  if (changeInfo.url) {
    tabTitlesCache[tabId].url = changeInfo.url;
    chrome.storage.local.set({ tabTitles: tabTitlesCache });
  }
});

// Fired when a tab is replaced with another tab due to prerendering or instant.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (tabTitlesCache[removedTabId]) {
    console.log(
      `Tab ${removedTabId} was replaced by ${addedTabId}. Transferring title.`,
    );
    const record = tabTitlesCache[removedTabId];
    tabTitlesCache[addedTabId] = record;
    delete tabTitlesCache[removedTabId];

    chrome.storage.local.set({ tabTitles: tabTitlesCache });

    // Apply the title to the new tab immediately.
    chrome.tabs.sendMessage(
      addedTabId,
      { type: 'set_custom_title', title: record.title },
      () => {
        if (chrome.runtime.lastError) {
          console.warn(
            `Could not apply title to replaced tab ${addedTabId} immediately.`,
          );
        }
      },
    );
  }
});

// Clean up storage and cache when a tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabTitlesCache[tabId]) {
    delete tabTitlesCache[tabId];
    chrome.storage.local.set({ tabTitles: tabTitlesCache });
  }
});
