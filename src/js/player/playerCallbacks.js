// Player state and track change callbacks for TourPlayer
// Exports: onStateChange, onTrackChange, onError
import { showStatus } from '../utils/appUtils.js';
import { calculateDistance, calculateBearing, bearingToCompassDirection, formatDistance } from '../index.js';
import { prevBtn, nextBtn, playPauseBtn, currentPosition, currentArticleDiv, currentTitleLink, currentDistanceDiv, currentSnippetDiv, currentImageContainer, emptyStateDiv } from '../dom/elements.js';

export const onStateChange = (state) => {
    if (state.playing) {
        stopBtn.classList.remove('hidden');
    } else {
        stopBtn.classList.add('hidden');
        if (state.completed) {
            showStatus(state.message, 'success');
        }
    }

    if (playPauseBtn) {
        playPauseBtn.textContent = state.playing ? '⏸' : '▶️';
        playPauseBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    }

    if (prevBtn && nextBtn) {
        const hasQueue = state.queueLength > 0;
        prevBtn.disabled = !hasQueue || state.currentIndex <= 0;
        nextBtn.disabled = !hasQueue || state.currentIndex >= state.queueLength - 1;
    }
};

export const onTrackChange = (article, index, total) => {
    showStatus(`Reading: ${article.title} (${index + 1}/${total})`, 'success');

    // Set location context in the format: '30 meters north of you is ...'
    if (window.currentPosition && window.currentPosition.coords && article.lat && article.lon) {
        const { latitude, longitude } = window.currentPosition.coords;
        const distance = calculateDistance(latitude, longitude, article.lat, article.lon);
        const bearing = calculateBearing(latitude, longitude, article.lat, article.lon);
        const direction = bearingToCompassDirection(bearing);
        const distanceText = formatDistance(distance);
        // Example: '30 meters north of you is '
        article._locationContext = `${distanceText} ${direction.toLowerCase()} of you is `;
    }
    // ...existing code for rendering...
};

export const onError = (message) => {
    showStatus(`Error: ${message}`, 'error');
};
