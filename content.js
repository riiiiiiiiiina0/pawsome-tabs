let isSettingCustomTitle = false; // A flag to bypass our own setter
let hasCustomTitle = false;
let originalTitleOnLoad = document.title;
let pendingCustomTitle = null; // Store pending custom title during page load

// Immediately check if this tab should have a custom title
// This runs as soon as the content script is injected
const checkForCustomTitleImmediately = () => {
  chrome.runtime.sendMessage({ type: 'check_custom_title' }, (response) => {
    if (chrome.runtime.lastError) {
      // Background script might not be ready, will try again later
      return;
    }
    if (response && response.hasCustomTitle) {
      if (response.monitoringSelector) {
        chrome.runtime.sendMessage({ type: 'monitor_element', selector: response.monitoringSelector });
      } else if (response.title) {
        pendingCustomTitle = response.title;
        hasCustomTitle = true;
        // Apply immediately if possible
        if (document.readyState !== 'loading') {
          isSettingCustomTitle = true;
          document.title = response.title;
          isSettingCustomTitle = false;
        }
      }
    }
  });
};

// Run the check immediately
checkForCustomTitleImmediately();

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

let isPicking = false;
let highlightElement = null;
let currentObserver = null;

const createCssSelector = (el) => {
  if (!(el instanceof Element)) return;
  const path = [];
  while (el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.id) {
      selector += '#' + el.id;
      path.unshift(selector);
      break;
    } else {
      let sib = el, nth = 1;
      while (sib = sib.previousElementSibling) {
        if (sib.nodeName.toLowerCase() == selector)
          nth++;
      }
      if (nth != 1)
        selector += ":nth-of-type("+nth+")";
    }
    path.unshift(selector);
    el = el.parentNode;
  }
  return path.join(" > ");
}

const startPicking = () => {
  if (isPicking) return;
  isPicking = true;
  document.body.style.cursor = 'crosshair';

  const mouseoverHandler = (e) => {
    if (highlightElement) {
      highlightElement.style.outline = '';
    }
    highlightElement = e.target;
    highlightElement.style.outline = '2px solid red';
  };

  const clickHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (highlightElement) {
      highlightElement.style.outline = '';
      const selector = createCssSelector(highlightElement);
      chrome.runtime.sendMessage({ type: 'element_selected', selector: selector });
    }
    stopPicking();
  };

  const stopPicking = () => {
    document.body.style.cursor = 'default';
    if (highlightElement) {
      highlightElement.style.outline = '';
    }
    document.removeEventListener('mouseover', mouseoverHandler);
    document.removeEventListener('click', clickHandler);
    isPicking = false;
  };

  document.addEventListener('mouseover', mouseoverHandler);
  document.addEventListener('click', clickHandler, true);
};


// Listener for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'start_picking':
      startPicking();
      break;
    case 'get_new_title_prompt':
      // The prompt should show the current title, whether it's custom or original.
      const newTitle = prompt(
        'Enter a new title for this tab:',
        document.title,
      );
      sendResponse({ newTitle: newTitle });
      break;

    case 'monitor_element':
      const selector = request.selector;
      const element = document.querySelector(selector);
      if (element) {
        const updateTitle = () => {
          const newTitle = element.textContent.trim();
          if (document.title !== newTitle) {
            isSettingCustomTitle = true;
            document.title = newTitle;
            isSettingCustomTitle = false;
            chrome.runtime.sendMessage({ type: 'update_title', title: newTitle, monitoringSelector: selector });
          }
        };

        updateTitle(); // Set initial title

        if (currentObserver) {
          currentObserver.disconnect();
        }
        currentObserver = new MutationObserver(updateTitle);
        currentObserver.observe(element, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      } else {
        isSettingCustomTitle = true;
        document.title = '[Monitoring] Element not found';
        isSettingCustomTitle = false;
      }
      break;

    case 'set_custom_title':
      if (currentObserver) {
        currentObserver.disconnect();
        currentObserver = null;
      }
      pendingCustomTitle = request.title;
      hasCustomTitle = true;
      isSettingCustomTitle = true;
      document.title = request.title;
      isSettingCustomTitle = false;
      pendingCustomTitle = null; // Clear pending since we've applied it

      // Re-assert the title multiple times to override any late-loading page scripts
      // This is more aggressive to handle pages that change titles after load
      const reassertTitle = () => {
        if (hasCustomTitle) {
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
      if (currentObserver) {
        currentObserver.disconnect();
        currentObserver = null;
      }
      hasCustomTitle = false;
      pendingCustomTitle = null;
      // Restore the title to what it was when the page first loaded.
      isSettingCustomTitle = true;
      document.title = originalTitleOnLoad;
      isSettingCustomTitle = false;
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
