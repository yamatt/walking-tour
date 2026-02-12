// Utility functions for app.js

export function preventDoubleTapZoom(element, thresholdMs) {
    let lastTap = 0;
    element.addEventListener('touchend', (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < thresholdMs && tapLength > 0) {
            e.preventDefault();
        }
        lastTap = currentTime;
    });
}

export function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove('hidden');
    // Optionally log to debug
    if (window.logDebug) window.logDebug(message, type);
}

export function hideStatus() {
    const statusDiv = document.getElementById('status');
    statusDiv.classList.add('hidden');
}
