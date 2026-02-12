export function createDebugLogger(panel, log) {
    const entries = [];

    const logDebug = (message, level = 'info') => {
        if (!panel || !log || !message) return;

        const timestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        entries.push({ timestamp, message, level });

        const shouldStick = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;

        const row = document.createElement('div');
        row.className = `debug-entry debug-entry--${level}`;

        const time = document.createElement('div');
        time.className = 'debug-time';
        time.textContent = timestamp;

        const text = document.createElement('div');
        text.className = 'debug-message';
        text.textContent = message;

        row.appendChild(time);
        row.appendChild(text);
        log.appendChild(row);

        if (shouldStick) {
            log.scrollTop = log.scrollHeight;
        }
    };

    const attachGlobalHandlers = () => {
        if (!panel || !log) return;

        window.addEventListener('error', (event) => {
            if (event && event.message) {
                logDebug(`Error: ${event.message}`, 'error');
            }
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event && event.reason ? String(event.reason) : 'Unknown rejection';
            logDebug(`Promise: ${reason}`, 'warn');
        });
    };

    return { logDebug, attachGlobalHandlers, entries };
}
