import '../styles.css';
import {
    LOCATION_CHECK_INTERVAL_MS,
    ARTICLE_SWITCH_THRESHOLD_METERS,
    DOUBLE_TAP_THRESHOLD_MS,
    TourPlayer,
    fetchNearbyArticles as fetchNearbyArticlesApi,
    fetchArticleImages as fetchArticleImagesApi,
    fetchArticleSnippet as fetchArticleSnippetApi,
    calculateDistance,
    calculateBearing,
    bearingToCompassDirection,
    formatDistance,
    createDebugLogger
} from './index.js';

// =============================================================================
// Application State
// =============================================================================
let currentPosition = null;
let locationWatchId = null;
let lastLocationCheck = null;
let nearbyArticles = [];
let currentArticle = null;
const imageCache = new Map();
const snippetCache = new Map();
const tourPlayer = new TourPlayer();

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshBtn = document.getElementById('refreshBtn');
const statusDiv = document.getElementById('status');
const locationInfo = document.getElementById('locationInfo');
const loadingDiv = document.getElementById('loading');
const prevBtn = document.getElementById('prevBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const nextBtn = document.getElementById('nextBtn');
const currentArticleDiv = document.getElementById('currentArticle');
const currentTitleLink = document.getElementById('currentTitle');
const currentDistanceDiv = document.getElementById('currentDistance');
const currentImageContainer = document.getElementById('currentImage');
const currentSnippetDiv = document.getElementById('currentSnippet');
const emptyStateDiv = document.getElementById('emptyState');
const debugPanel = document.getElementById('debugPanel');
const debugLog = document.getElementById('debugLog');

const { logDebug, attachGlobalHandlers } = createDebugLogger(debugPanel, debugLog);

// =============================================================================
// Player Callbacks
// =============================================================================
// eslint-disable-next-line no-unused-vars
const onStateChange = (state) => {
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

tourPlayer.onStateChange = onStateChange;

tourPlayer.onTrackChange = (article, index, total) => {
    showStatus(`Reading: ${article.title} (${index + 1}/${total})`, 'success');

    if (currentPosition) {
        const { latitude, longitude } = currentPosition.coords;
        const distance = calculateDistance(latitude, longitude, article.lat, article.lon);
        const bearing = calculateBearing(latitude, longitude, article.lat, article.lon);
        const direction = bearingToCompassDirection(bearing);
        const distanceText = formatDistance(distance);

        const locationContext = `${distanceText} to your ${direction} is `;
        article._locationContext = locationContext;
    }

    renderCurrentArticle(article, index, total);

    if (prevBtn && nextBtn) {
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = index >= total - 1;
    }
};

tourPlayer.onError = (message) => {
    showStatus(`Error: ${message}`, 'error');
};

// =============================================================================
// Initialization
// =============================================================================
function init() {
    startBtn.addEventListener('click', startTour);
    stopBtn.addEventListener('click', () => tourPlayer.stop());
    refreshBtn.addEventListener('click', refreshNearbyPlaces);

    if (prevBtn && playPauseBtn && nextBtn) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        prevBtn.addEventListener('click', () => tourPlayer.previous());
        nextBtn.addEventListener('click', () => tourPlayer.next());
        playPauseBtn.addEventListener('click', () => {
            if (tourPlayer.getIsPlaying()) {
                tourPlayer.stop();
            } else if (nearbyArticles.length > 0) {
                tourPlayer.play();
            } else {
                startTour();
            }
        });

        preventDoubleTapZoom(prevBtn);
        preventDoubleTapZoom(playPauseBtn);
        preventDoubleTapZoom(nextBtn);
    }

    preventDoubleTapZoom(startBtn);
    preventDoubleTapZoom(stopBtn);
    preventDoubleTapZoom(refreshBtn);

    window.addEventListener('beforeunload', () => {
        tourPlayer.stop();
    });

    attachGlobalHandlers();
}

// =============================================================================
// Utility Functions
// =============================================================================
function preventDoubleTapZoom(element) {
    let lastTap = 0;
    element.addEventListener('touchend', (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < DOUBLE_TAP_THRESHOLD_MS && tapLength > 0) {
            e.preventDefault();
        }
        lastTap = currentTime;
    });
}

function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove('hidden');
    logDebug(message, type);
}

function hideStatus() {
    statusDiv.classList.add('hidden');
}

// =============================================================================
// Location & Tour Management
// =============================================================================
function startTour() {
    if (!navigator.geolocation) {
        showStatus('Geolocation is not supported by your browser', 'error');
        return;
    }

    showStatus('Getting your location...', 'info');
    startBtn.disabled = true;

    locationWatchId = navigator.geolocation.watchPosition(
        onLocationSuccess,
        onLocationError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function onLocationSuccess(position) {
    const now = Date.now();
    const { latitude, longitude } = position.coords;

    currentPosition = position;

    locationInfo.textContent = `📍 Your location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    locationInfo.classList.remove('hidden');

    if (!lastLocationCheck || (now - lastLocationCheck) > LOCATION_CHECK_INTERVAL_MS) {
        lastLocationCheck = now;

        if (!nearbyArticles.length) {
            showStatus('Location found! Searching for nearby places...', 'success');
            refreshBtn.classList.remove('hidden');
            fetchNearbyArticles(latitude, longitude);
        } else {
            updateDistancesAndCheckSwitch(latitude, longitude);
        }
    }
}

function onLocationError(error) {
    let message = 'Unable to get your location. ';
    switch (error.code) {
        case error.PERMISSION_DENIED:
            message += 'Please allow location access.';
            break;
        case error.POSITION_UNAVAILABLE:
            message += 'Location information unavailable.';
            break;
        case error.TIMEOUT:
            message += 'Location request timed out.';
            break;
        default:
            message += 'An unknown error occurred.';
    }
    showStatus(message, 'error');
    startBtn.disabled = false;

    if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

function refreshNearbyPlaces() {
    if (currentPosition) {
        const { latitude, longitude } = currentPosition.coords;
        nearbyArticles = [];
        currentArticle = null;
        imageCache.clear();
        snippetCache.clear();
        if (currentArticleDiv) currentArticleDiv.classList.add('hidden');
        if (emptyStateDiv) emptyStateDiv.classList.add('hidden');
        tourPlayer.loadQueue([]);
        showStatus('Refreshing nearby places...', 'info');
        fetchNearbyArticles(latitude, longitude);
    }
}

function updateDistancesAndCheckSwitch(lat, lon) {
    if (!nearbyArticles.length) return;

    nearbyArticles.forEach((article) => {
        article.currentDist = calculateDistance(lat, lon, article.lat, article.lon);
    });

    nearbyArticles.sort((a, b) => a.currentDist - b.currentDist);

    if (currentArticle) {
        const currentIndex = nearbyArticles.findIndex(
            (article) => article.pageid === currentArticle.pageid
        );
        if (currentIndex >= 0) {
            renderCurrentArticle(currentArticle, currentIndex, nearbyArticles.length);
        }
    }

    tourPlayer.updateQueue(nearbyArticles);

    if (tourPlayer.autoPlayEnabled && tourPlayer.getIsPlaying()) {
        const playingArticle = tourPlayer.getCurrentArticle();
        const nearestArticle = nearbyArticles[0];

        if (playingArticle && nearestArticle &&
            playingArticle.pageid !== nearestArticle.pageid &&
            nearestArticle.currentDist < playingArticle.currentDist - ARTICLE_SWITCH_THRESHOLD_METERS) {

            showStatus(`Switching to nearer place: ${nearestArticle.title}`, 'info');
            tourPlayer.playTrack(0);
        }
    }
}

// =============================================================================
// Wikipedia API Functions
// =============================================================================
async function fetchNearbyArticles(lat, lon) {
    loadingDiv.classList.remove('hidden');

    try {
        const results = await fetchNearbyArticlesApi(lat, lon);
        loadingDiv.classList.add('hidden');

        if (results.length > 0) {
            nearbyArticles = results.map((article) => ({
                ...article,
                currentDist: calculateDistance(lat, lon, article.lat, article.lon)
            }));

            nearbyArticles.sort((a, b) => a.currentDist - b.currentDist);

            showStatus(`Found ${nearbyArticles.length} places nearby`, 'success');
            displayArticles(nearbyArticles);

            await fetchAndCacheImages(nearbyArticles.map((article) => article.pageid));

            tourPlayer.loadQueue(nearbyArticles);
            setTimeout(() => {
                tourPlayer.play();
            }, 1000);
        } else {
            showStatus('No places found nearby. Try moving to a different location.', 'info');
            if (currentArticleDiv) currentArticleDiv.classList.add('hidden');
            if (emptyStateDiv) emptyStateDiv.classList.remove('hidden');
        }

        startBtn.disabled = false;
    } catch (error) {
        loadingDiv.classList.add('hidden');
        showStatus(`Error fetching nearby places: ${error.message}`, 'error');
        startBtn.disabled = false;
    }
}

async function fetchAndCacheImages(pageids) {
    try {
        const imageMap = await fetchArticleImagesApi(pageids);
        imageMap.forEach((url, pageid) => {
            imageCache.set(pageid, url);
            if (currentArticle && currentArticle.pageid === pageid) {
                updateCurrentImageForArticle(pageid);
            }
        });
    } catch (error) {
        console.error('Error fetching article images:', error);
    }
}

async function fetchArticleSnippet(pageid) {
    try {
        const extract = await fetchArticleSnippetApi(pageid);
        if (extract) {
            snippetCache.set(pageid, extract);
            if (currentArticle && currentArticle.pageid === pageid && currentSnippetDiv) {
                currentSnippetDiv.textContent = extract;
            }
        }
    } catch (error) {
        console.error('Error fetching snippet:', error);
    }
}

function displayArticles(articles) {
    if (!currentArticleDiv || !emptyStateDiv) return;

    if (articles.length === 0) {
        currentArticleDiv.classList.add('hidden');
        emptyStateDiv.classList.remove('hidden');
        currentArticle = null;
        if (currentTitleLink) currentTitleLink.textContent = '';
        if (currentDistanceDiv) currentDistanceDiv.textContent = '';
        if (currentSnippetDiv) currentSnippetDiv.textContent = '';
        if (currentImageContainer) currentImageContainer.innerHTML = '';
        return;
    }

    emptyStateDiv.classList.add('hidden');
    currentArticleDiv.classList.remove('hidden');

    renderCurrentArticle(articles[0], 0, articles.length);

    articles.forEach((article) => {
        fetchArticleSnippet(article.pageid);
    });
}

function renderCurrentArticle(article, index, total) {
    if (!article || !currentArticleDiv) return;

    currentArticle = article;

    if (currentTitleLink) {
        currentTitleLink.textContent = article.title;
        currentTitleLink.href = `https://en.wikipedia.org/?curid=${article.pageid}`;
    }

    if (currentDistanceDiv) {
        const distance = article.currentDist ? `${Math.round(article.currentDist)} meters away` :
                         article.dist ? `${Math.round(article.dist)} meters away` :
                         'Distance unknown';
        currentDistanceDiv.textContent = `📏 ${distance} (${index + 1}/${total})`;
    }

    if (currentSnippetDiv) {
        const cachedSnippet = snippetCache.get(article.pageid);
        currentSnippetDiv.textContent = cachedSnippet || 'Loading description...';
    }

    updateCurrentImageForArticle(article.pageid);

    if (prevBtn && nextBtn) {
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = index >= total - 1;
    }
}

function updateCurrentImageForArticle(pageid) {
    if (!currentImageContainer) return;

    currentImageContainer.innerHTML = '';
    const imageUrl = imageCache.get(pageid);
    if (!imageUrl) return;

    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = currentArticle ? currentArticle.title : 'Article image';
    img.className = 'article-image';
    currentImageContainer.appendChild(img);
}

// =============================================================================
// App Initialization
// =============================================================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
