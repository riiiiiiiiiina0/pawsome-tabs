let isSettingCustomTitle = false; // A flag to bypass our own setter
let hasCustomTitle = false;
let originalTitleOnLoad = document.title;
let pendingCustomTitle = null; // Store pending custom title during page load

// DOM element monitoring variables
let selectedElementSelector = null;
let mutationObserver = null;
let isMonitoringElement = false;
let elementCheckInterval = null;
let lastElementContent = null;
let updateTitleDebounceTimer = null;
let fallbackTitle = null; // Store previous custom title as fallback

// Immediately check if this tab should have a custom title
// This runs as soon as the content script is injected
const checkForCustomTitleImmediately = () => {
  chrome.runtime.sendMessage({ type: 'check_custom_title' }, (response) => {
    if (chrome.runtime.lastError) {
      // Background script might not be ready, will try again later
      return;
    }
    if (response && response.hasCustomTitle && response.title) {
      pendingCustomTitle = response.title;
      hasCustomTitle = true;
      // Apply immediately if possible
      if (document.readyState !== 'loading') {
        isSettingCustomTitle = true;
        document.title = response.title;
        isSettingCustomTitle = false;
      }
    }
  });
};

// Run the check immediately
checkForCustomTitleImmediately();

// --- DOM Element Monitoring Functions ---

const getElementTextContent = (element) => {
  if (!element) return null;
  // Get text content and clean it up
  let text = element.textContent || element.innerText || '';
  text = text.trim().replace(/\s+/g, ' '); // Normalize whitespace
  return text || null;
};

const findElementBySelector = (selector) => {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch (error) {
    console.warn('Invalid selector:', selector, error);
    return null;
  }
};

const updateTitleFromElement = () => {
  if (!isMonitoringElement || !selectedElementSelector) return;

  const element = findElementBySelector(selectedElementSelector);
  let newContent;

  if (element) {
    newContent = getElementTextContent(element);
    if (!newContent) {
      newContent = '[Empty Element]';
    }
  } else {
    // Use fallback title if available, otherwise show element not found
    newContent = fallbackTitle || '[Element Not Found]';
  }

  // Only update if content has changed
  if (newContent !== lastElementContent) {
    lastElementContent = newContent;
    isSettingCustomTitle = true;
    document.title = newContent;
    isSettingCustomTitle = false;
    console.log('Updated title from DOM element:', newContent);
  }
};

const startElementMonitoring = (selector) => {
  // Stop any existing monitoring
  stopElementMonitoring();

  selectedElementSelector = selector;
  isMonitoringElement = true;
  hasCustomTitle = true;

  console.log('Starting DOM element monitoring for selector:', selector);

  // Request fallback title from background script before starting monitoring
  chrome.runtime.sendMessage({ type: 'get_fallback_title' }, (response) => {
    if (response && response.fallbackTitle) {
      fallbackTitle = response.fallbackTitle;
      console.log('Using fallback title:', fallbackTitle);
    } else {
      fallbackTitle = null;
    }

    // Initial title update after getting fallback
    updateTitleFromElement();
  });

  // Set up MutationObserver to watch for DOM changes
  mutationObserver = new MutationObserver((mutations) => {
    let shouldUpdate = false;

    // Check if our target element or its descendants were modified
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        const element = findElementBySelector(selectedElementSelector);
        if (element) {
          // Check if the mutation affects our target element or its descendants
          if (
            element.contains(mutation.target) ||
            mutation.target === element
          ) {
            shouldUpdate = true;
          }
        } else {
          // Element might have been removed/added
          shouldUpdate = true;
        }
      }
    });

    if (shouldUpdate) {
      // Debounce updates to avoid excessive title changes
      clearTimeout(updateTitleDebounceTimer);
      updateTitleDebounceTimer = setTimeout(updateTitleFromElement, 100);
    }
  });

  // Observe the entire document for changes
  mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also set up a periodic check in case the element becomes temporarily unavailable
  elementCheckInterval = setInterval(() => {
    updateTitleFromElement();
  }, 2000); // Check every 2 seconds
};

const stopElementMonitoring = () => {
  console.log('Stopping DOM element monitoring');

  isMonitoringElement = false;
  selectedElementSelector = null;
  lastElementContent = null;
  fallbackTitle = null;

  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  if (elementCheckInterval) {
    clearInterval(elementCheckInterval);
    elementCheckInterval = null;
  }

  // Clear any pending debounced updates
  if (updateTitleDebounceTimer) {
    clearTimeout(updateTitleDebounceTimer);
    updateTitleDebounceTimer = null;
  }
};

const originalTitleDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  'title',
);
if (originalTitleDescriptor) {
  const originalTitleSetter = originalTitleDescriptor.set;
  const originalTitleGetter = originalTitleDescriptor.get;

  Object.defineProperty(document, 'title', {
    get: function () {
      return originalTitleGetter ? originalTitleGetter.call(this) : '';
    },
    set: function (newTitle) {
      if (isSettingCustomTitle) {
        // This is our own call, allow it.
        if (originalTitleSetter) {
          originalTitleSetter.call(this, newTitle);
        }
        return;
      }
      if (isMonitoringElement) {
        console.log(
          `Blocked page from changing title to "${newTitle}" due to DOM element monitoring.`,
        );
        return; // Block the change when monitoring a DOM element
      }
      if (hasCustomTitle || pendingCustomTitle) {
        console.log(`Blocked page from changing title to "${newTitle}".`);
        // If we have a pending custom title, apply it now
        if (pendingCustomTitle && !hasCustomTitle) {
          hasCustomTitle = true;
          isSettingCustomTitle = true;
          if (originalTitleSetter) {
            originalTitleSetter.call(this, pendingCustomTitle);
          }
          isSettingCustomTitle = false;
          pendingCustomTitle = null;
        }
        return; // Block the change
      }
      console.log(`Page trying to set title to: "${newTitle}"`);
      if (originalTitleSetter) {
        originalTitleSetter.call(this, newTitle);
      }
    },
    configurable: true,
  });
}

// Listener for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'get_new_title_prompt':
      // The prompt should show the current title, whether it's custom or original.
      const newTitle = prompt(
        'Enter a new title for this tab:',
        document.title,
      );
      sendResponse({ newTitle: newTitle });
      break;

    case 'set_custom_title':
      // Stop any DOM element monitoring when setting a manual custom title
      stopElementMonitoring();

      pendingCustomTitle = request.title;
      hasCustomTitle = true;
      isSettingCustomTitle = true;
      document.title = request.title;
      isSettingCustomTitle = false;
      pendingCustomTitle = null; // Clear pending since we've applied it

      // Re-assert the title multiple times to override any late-loading page scripts
      // This is more aggressive to handle pages that change titles after load
      const reassertTitle = () => {
        if (hasCustomTitle && !isMonitoringElement) {
          isSettingCustomTitle = true;
          document.title = request.title;
          isSettingCustomTitle = false;
        }
      };

      setTimeout(reassertTitle, 100);
      setTimeout(reassertTitle, 500);
      setTimeout(reassertTitle, 1000);
      setTimeout(reassertTitle, 2000);

      // Send confirmation back to background script
      sendResponse({ success: true });
      break;

    case 'remove_custom_title':
      // Stop any DOM element monitoring when removing custom title
      stopElementMonitoring();

      hasCustomTitle = false;
      pendingCustomTitle = null;
      // Restore the title to what it was when the page first loaded.
      isSettingCustomTitle = true;
      document.title = originalTitleOnLoad;
      isSettingCustomTitle = false;
      break;

    case 'init_dom_selector':
      // Initialize DOM selector with callback to start monitoring the selected element
      // @ts-ignore - domElementHighlighter is added by the dom-selector.js library
      if (window.domElementHighlighter) {
        // @ts-ignore
        window.domElementHighlighter.init(true, (selector) => {
          if (selector && selector.trim()) {
            console.log('Selected DOM element selector:', selector);
            // Start monitoring the selected element
            startElementMonitoring(selector);

            // Notify background script about the DOM element selection
            chrome.runtime.sendMessage({
              type: 'dom_element_selected',
              selector: selector,
            });
          } else {
            console.log('DOM element selection cancelled');
          }
        });
      } else {
        console.error('DOM element highlighter not available');
      }
      sendResponse({ success: true });
      break;
  }
  return true; // Needed for async sendResponse
});

// Apply pending custom title when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (pendingCustomTitle && !hasCustomTitle) {
    hasCustomTitle = true;
    isSettingCustomTitle = true;
    document.title = pendingCustomTitle;
    isSettingCustomTitle = false;
    pendingCustomTitle = null;
  }
});

// Also try when the page is fully loaded
window.addEventListener('load', () => {
  if (pendingCustomTitle && !hasCustomTitle) {
    hasCustomTitle = true;
    isSettingCustomTitle = true;
    document.title = pendingCustomTitle;
    isSettingCustomTitle = false;
    pendingCustomTitle = null;
  }
});

// Additional safeguard: Check if we should have a custom title when the page is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  // Only check if we don't already have a custom title
  if (!hasCustomTitle && !pendingCustomTitle) {
    // Ask the background script if this tab should have a custom title
    chrome.runtime.sendMessage({ type: 'check_custom_title' }, (response) => {
      if (chrome.runtime.lastError) {
        // Background script might not be ready, ignore
        return;
      }
      if (response && response.hasCustomTitle && response.title) {
        // Apply the custom title if we should have one but don't
        if (!hasCustomTitle || document.title !== response.title) {
          hasCustomTitle = true;
          isSettingCustomTitle = true;
          document.title = response.title;
          isSettingCustomTitle = false;
        }
      }
    });
  }
});

// Clean up DOM element monitoring when navigating away from the page
const cleanupOnNavigation = () => {
  if (isMonitoringElement) {
    console.log('Page navigation detected, stopping DOM element monitoring');
    stopElementMonitoring();
  }
};

// Listen for page navigation events
window.addEventListener('beforeunload', cleanupOnNavigation);
// The 'pagehide' event is triggered when the user is navigating away from the page,
// such as when the page is being unloaded, the user is closing the tab, or navigating to a different URL.
// It also fires when the page is being put into the session history (e.g., with the back/forward cache).
window.addEventListener('pagehide', cleanupOnNavigation);

// Listen for navigation in single-page applications
// let currentUrl = window.location.href;
// const checkForNavigation = () => {
//   if (window.location.href !== currentUrl) {
//     currentUrl = window.location.href;
//     cleanupOnNavigation();
//   }
// };

// // Check for URL changes periodically (for SPAs)
// setInterval(checkForNavigation, 1000);
