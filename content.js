let isSettingCustomTitle = false; // A flag to bypass our own setter
let hasCustomTitle = false;
let originalTitleOnLoad = document.title;

const originalTitleDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
if (originalTitleDescriptor) {
    const originalTitleSetter = originalTitleDescriptor.set;
    const originalTitleGetter = originalTitleDescriptor.get;

    Object.defineProperty(document, 'title', {
        get: function() {
            return originalTitleGetter.call(this);
        },
        set: function(newTitle) {
            if (isSettingCustomTitle) {
                // This is our own call, allow it.
                originalTitleSetter.call(this, newTitle);
                return;
            }
            if (hasCustomTitle) {
                console.log(`Blocked page from changing title to "${newTitle}".`);
                return; // Block the change
            }
            console.log(`Page trying to set title to: "${newTitle}"`);
            originalTitleSetter.call(this, newTitle);
        },
        configurable: true
    });
}

// Listener for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'get_new_title_prompt':
            // The prompt should show the current title, whether it's custom or original.
            const newTitle = prompt("Enter a new title for this tab:", document.title);
            sendResponse({ newTitle: newTitle });
            break;

        case 'set_custom_title':
            hasCustomTitle = true;
            isSettingCustomTitle = true;
            document.title = request.title;
            isSettingCustomTitle = false;
            // Re-assert the title after a short delay to override any late-loading page scripts.
            setTimeout(() => {
                isSettingCustomTitle = true;
                document.title = request.title;
                isSettingCustomTitle = false;
            }, 500);
            break;

        case 'remove_custom_title':
            hasCustomTitle = false;
            // Restore the title to what it was when the page first loaded.
            isSettingCustomTitle = true;
            document.title = originalTitleOnLoad;
            isSettingCustomTitle = false;
            break;
    }
    return true; // Needed for async sendResponse
});
