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

import { onStateChange, onTrackChange, onError } from './player/playerCallbacks.js';

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
tourPlayer.onStateChange = onStateChange;
tourPlayer.onTrackChange = onTrackChange;
tourPlayer.onError = onError;

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

import { preventDoubleTapZoom, showStatus, hideStatus } from './utils/appUtils.js';

// =============================================================================
// Location & Tour Management
// =============================================================================

let didUnlockSpeech = false;
function unlockSpeechAndAudio() {
    return new Promise((resolve) => {
        // Unlock AudioContext if needed
        if (tourPlayer.audioContext && tourPlayer.audioContext.state === 'suspended') {
            tourPlayer.audioContext.resume().then(() => {
                logDebug('AudioContext resumed by user gesture');
            });
        }
        // Unlock speechSynthesis with a dummy utterance
        if (window.speechSynthesis && !didUnlockSpeech) {
            try {
                const utter = new window.SpeechSynthesisUtterance(' ');
                utter.volume = 0;
                utter.rate = 1;
                utter.onend = () => {
                    logDebug('Dummy speech utterance ended (unlock)');
                    didUnlockSpeech = true;
                    resolve();
                };
                utter.onerror = () => {
                    logDebug('Dummy speech utterance error (unlock)');
                    didUnlockSpeech = true;
                    resolve();
                };
                window.speechSynthesis.speak(utter);
                logDebug('Dummy speech utterance spoken (unlock)');
            } catch (e) {
                logDebug('Speech unlock error: ' + e);
                resolve();
            }
        } else {
            resolve();
        }
    });
}

async function startTour() {
    await unlockSpeechAndAudio();
    // Check if voices are loaded (for Chrome Android)
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!voices || voices.length === 0) {
        showStatus('Speech system not ready. Please tap Start again or reload the page.', 'error');
        startBtn.disabled = false;
        return;
    }

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
    window.currentPosition = position;

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
    if (!nearbyArticles.length) {
        logDebug('No nearby articles, not switching.');
        return;
    }

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

        logDebug('Checking for article switch:', {
            playingArticle: playingArticle ? playingArticle.title : null,
            nearestArticle: nearestArticle ? nearestArticle.title : null,
            playingPageId: playingArticle ? playingArticle.pageid : null,
            nearestPageId: nearestArticle ? nearestArticle.pageid : null,
            playingDist: playingArticle ? playingArticle.currentDist : null,
            nearestDist: nearestArticle ? nearestArticle.currentDist : null,
            threshold: ARTICLE_SWITCH_THRESHOLD_METERS
        });

        if (playingArticle && nearestArticle &&
            playingArticle.pageid !== nearestArticle.pageid &&
            nearestArticle.currentDist < playingArticle.currentDist - ARTICLE_SWITCH_THRESHOLD_METERS) {

            logDebug(`Switching to nearer place: ${nearestArticle.title}`);
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

export function renderCurrentArticle(article, index, total) {
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
