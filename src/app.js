// Import styles
import './styles.css';

// Configuration constants
const LOCATION_CHECK_INTERVAL_MS = 30000; // 30 seconds between location checks
const ARTICLE_SWITCH_THRESHOLD_METERS = 100; // Switch to nearer article if 100m closer
const ARTICLE_PAUSE_MS = 2000; // 2 second pause between articles
const SWIPE_THRESHOLD_PX = 50; // Minimum swipe distance for gesture detection
const DOUBLE_TAP_THRESHOLD_MS = 500; // Double-tap detection window in milliseconds

// State management
let currentPosition = null;
let speechSynth = window.speechSynthesis;
let currentUtterance = null;
let isSpeaking = false;
let autoPlayMode = true;
let nearbyArticles = [];
let currentArticleIndex = 0;
let locationWatchId = null;
let lastLocationCheck = null;

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshBtn = document.getElementById('refreshBtn');
const statusDiv = document.getElementById('status');
const locationInfo = document.getElementById('locationInfo');
const articlesDiv = document.getElementById('articles');
const loadingDiv = document.getElementById('loading');

// Initialize event listeners
function init() {
    startBtn.addEventListener('click', startTour);
    stopBtn.addEventListener('click', stopSpeaking);
    refreshBtn.addEventListener('click', refreshNearbyPlaces);

    // Set up keyboard navigation once
    setupArticleNavigation();

    // Prevent zoom on double-tap for buttons (mobile)
    preventDoubleTapZoom(startBtn);
    preventDoubleTapZoom(stopBtn);
    preventDoubleTapZoom(refreshBtn);

    // Stop speaking when page is unloaded
    window.addEventListener('beforeunload', () => {
        stopSpeaking();
    });

    // Handle visibility changes (e.g., screen lock on mobile)
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

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

function handleVisibilityChange() {
    // Pause speech when app goes to background (optional)
    if (document.hidden && isSpeaking) {
        // On mobile, speech might continue in background
        // This is actually desirable for a walking tour app
        console.log('App in background, speech continues');
    }
}

function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove('hidden');
}

function hideStatus() {
    statusDiv.classList.add('hidden');
}

function startTour() {
    if (!navigator.geolocation) {
        showStatus('Geolocation is not supported by your browser', 'error');
        return;
    }

    showStatus('Getting your location...', 'info');
    startBtn.disabled = true;

    // Start watching location for continuous updates
    locationWatchId = navigator.geolocation.watchPosition(
        onLocationSuccess,
        onLocationError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function onLocationSuccess(position) {
    const now = Date.now();
    const { latitude, longitude } = position.coords;

    // Update current position
    currentPosition = position;

    locationInfo.textContent = `📍 Your location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    locationInfo.classList.remove('hidden');

    // On first location or if it's been more than the check interval since last check
    if (!lastLocationCheck || (now - lastLocationCheck) > LOCATION_CHECK_INTERVAL_MS) {
        lastLocationCheck = now;

        if (!nearbyArticles.length) {
            // First time - fetch articles
            showStatus('Location found! Searching for nearby places...', 'success');
            refreshBtn.classList.remove('hidden');
            fetchNearbyArticles(latitude, longitude);
        } else {
            // Update distances and check if we should switch articles
            updateDistancesAndCheckSwitch(latitude, longitude);
        }
    }
}

function onLocationError(error) {
    let message = 'Unable to get your location. ';
    switch(error.code) {
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

    // Stop watching location on error
    if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

function refreshNearbyPlaces() {
    if (currentPosition) {
        const { latitude, longitude } = currentPosition.coords;
        articlesDiv.innerHTML = '';
        nearbyArticles = [];
        showStatus('Refreshing nearby places...', 'info');
        fetchNearbyArticles(latitude, longitude);
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    // Haversine formula to calculate distance between two coordinates
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    // Calculate bearing from point 1 to point 2
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    const bearing = (θ * 180 / Math.PI + 360) % 360; // Convert to degrees

    return bearing;
}

function bearingToCompassDirection(bearing) {
    // Convert bearing (0-360 degrees) to compass direction
    const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
}

function formatDistance(meters) {
    // Format distance for speech
    if (meters < 1000) {
        return `${Math.round(meters)} meters`;
    } else {
        const km = (meters / 1000).toFixed(1);
        return `${km} kilometers`;
    }
}

function updateDistancesAndCheckSwitch(lat, lon) {
    if (!nearbyArticles.length) return;

    // Recalculate distances for all articles
    nearbyArticles.forEach(article => {
        article.currentDist = calculateDistance(lat, lon, article.lat, article.lon);
    });

    // Sort by distance
    nearbyArticles.sort((a, b) => a.currentDist - b.currentDist);

    // Update UI with new distances
    nearbyArticles.forEach((article, index) => {
        const card = document.querySelector(`[data-pageid="${article.pageid}"]`);
        if (card) {
            const distanceDiv = card.querySelector('.article-distance');
            if (distanceDiv) {
                distanceDiv.textContent = `📏 ${Math.round(article.currentDist)} meters away`;
            }
            // Update order in DOM
            articlesDiv.appendChild(card);
        }
    });

    // Check if we should switch to a nearer article
    if (autoPlayMode && isSpeaking) {
        const currentArticle = nearbyArticles[currentArticleIndex];
        const nearestArticle = nearbyArticles[0];

        // If the nearest article is different and significantly closer (threshold)
        if (currentArticle && nearestArticle &&
            currentArticle.pageid !== nearestArticle.pageid &&
            nearestArticle.currentDist < currentArticle.currentDist - ARTICLE_SWITCH_THRESHOLD_METERS) {

            showStatus(`Switching to nearer place: ${nearestArticle.title}`, 'info');
            currentArticleIndex = 0;
            readArticle(nearestArticle.pageid, nearestArticle.title);
        }
    }
}

async function fetchNearbyArticles(lat, lon) {
    loadingDiv.classList.remove('hidden');

    try {
        // Wikipedia geosearch API
        const url = `https://en.wikipedia.org/w/api.php?` +
            `action=query&` +
            `list=geosearch&` +
            `gscoord=${lat}|${lon}&` +
            `gsradius=10000&` + // 10000 meters (10km radius)
            `gslimit=10&` +
            `format=json&` +
            `origin=*`;

        const response = await fetch(url);
        const data = await response.json();

        loadingDiv.classList.add('hidden');

        if (data.query && data.query.geosearch && data.query.geosearch.length > 0) {
            // Store articles with their coordinates and calculate current distance
            nearbyArticles = data.query.geosearch.map(article => ({
                ...article,
                currentDist: calculateDistance(lat, lon, article.lat, article.lon)
            }));

            // Sort by distance (nearest first)
            nearbyArticles.sort((a, b) => a.currentDist - b.currentDist);

            showStatus(`Found ${nearbyArticles.length} places nearby`, 'success');
            displayArticles(nearbyArticles);

            // Fetch images for all articles
            fetchArticleImages(nearbyArticles.map(a => a.pageid));

            // Auto-start playing the nearest article
            if (autoPlayMode && nearbyArticles.length > 0) {
                currentArticleIndex = 0;
                setTimeout(() => {
                    readArticle(nearbyArticles[0].pageid, nearbyArticles[0].title);
                }, 1000);
            }
        } else {
            showStatus('No places found nearby. Try moving to a different location.', 'info');
            articlesDiv.innerHTML = '<p style="text-align: center; padding: 20px; color: #666;">No results found within 10km</p>';
        }

        startBtn.disabled = false;
    } catch (error) {
        loadingDiv.classList.add('hidden');
        showStatus('Error fetching nearby places: ' + error.message, 'error');
        startBtn.disabled = false;
    }
}

function displayArticles(articles) {
    articlesDiv.innerHTML = '';

    articles.forEach((article, index) => {
        const card = document.createElement('div');
        card.className = 'article-card';
        card.dataset.pageid = article.pageid;
        card.dataset.index = index;

        const distance = article.currentDist ? `${Math.round(article.currentDist)} meters away` :
                         article.dist ? `${Math.round(article.dist)} meters away` :
                         'Distance unknown';

        // Create image container (initially empty, will be populated by fetchArticleImages)
        const imageContainer = document.createElement('div');
        imageContainer.className = 'article-image-container';
        imageContainer.id = `image-${article.pageid}`;

        // Create elements safely to avoid XSS
        const titleLink = document.createElement('a');
        titleLink.className = 'article-title';
        titleLink.textContent = article.title;
        titleLink.href = `https://en.wikipedia.org/?curid=${article.pageid}`;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        // Prevent title click from triggering card click
        titleLink.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        const distanceDiv = document.createElement('div');
        distanceDiv.className = 'article-distance';
        distanceDiv.textContent = `📏 ${distance}`;

        const snippetDiv = document.createElement('div');
        snippetDiv.className = 'article-snippet';
        snippetDiv.id = `snippet-${article.pageid}`;
        snippetDiv.textContent = 'Click to load description...';

        card.appendChild(imageContainer);
        card.appendChild(titleLink);
        card.appendChild(distanceDiv);
        card.appendChild(snippetDiv);

        // Click to manually select and play
        card.addEventListener('click', () => {
            currentArticleIndex = index;
            readArticle(article.pageid, article.title);
        });

        articlesDiv.appendChild(card);

        // Fetch snippet for each article
        fetchArticleSnippet(article.pageid);
    });
}

async function fetchArticleImages(pageids) {
    try {
        // Fetch images for multiple pages at once
        const url = `https://en.wikipedia.org/w/api.php?` +
            `action=query&` +
            `prop=pageimages&` +
            `piprop=thumbnail&` +
            `pithumbsize=300&` +
            `pageids=${pageids.join('|')}&` +
            `format=json&` +
            `origin=*`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.pages) {
            Object.values(data.query.pages).forEach(page => {
                if (page.thumbnail) {
                    const imageContainer = document.getElementById(`image-${page.pageid}`);
                    if (imageContainer) {
                        const img = document.createElement('img');
                        img.src = page.thumbnail.source;
                        img.alt = page.title || 'Article image';
                        img.className = 'article-image';
                        img.loading = 'lazy';
                        imageContainer.appendChild(img);
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error fetching article images:', error);
    }
}

function setupArticleNavigation() {
    // Add keyboard navigation (only set up once during init)
    document.addEventListener('keydown', handleKeyNavigation);

    // Add touch swipe navigation for mobile
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    articlesDiv.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    articlesDiv.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipeGesture();
    }, { passive: true });

    function handleSwipeGesture() {
        const diffX = touchStartX - touchEndX;
        const diffY = touchStartY - touchEndY;

        // Only handle horizontal swipes (not vertical scrolling)
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > SWIPE_THRESHOLD_PX) {
            if (diffX > 0) {
                // Swipe left - next article
                navigateToArticle(currentArticleIndex + 1);
            } else {
                // Swipe right - previous article
                navigateToArticle(currentArticleIndex - 1);
            }
        }
    }
}

function handleKeyNavigation(e) {
    if (!nearbyArticles.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        navigateToArticle(currentArticleIndex + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateToArticle(currentArticleIndex - 1);
    }
}

function navigateToArticle(newIndex) {
    if (newIndex < 0 || newIndex >= nearbyArticles.length) return;

    currentArticleIndex = newIndex;
    const article = nearbyArticles[currentArticleIndex];
    readArticle(article.pageid, article.title);

    // Scroll to the article card
    const card = document.querySelector(`[data-pageid="${article.pageid}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

async function fetchArticleSnippet(pageid) {
    try {
        const url = `https://en.wikipedia.org/w/api.php?` +
            `action=query&` +
            `prop=extracts&` +
            `exintro=&` +
            `explaintext=&` +
            `exsentences=2&` +
            `pageids=${pageid}&` +
            `format=json&` +
            `origin=*`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.pages && data.query.pages[pageid]) {
            const page = data.query.pages[pageid];
            const snippetDiv = document.getElementById(`snippet-${pageid}`);
            if (snippetDiv && page.extract) {
                snippetDiv.textContent = page.extract;
            }
        }
    } catch (error) {
        console.error('Error fetching snippet:', error);
    }
}

function cancelCurrentSpeech() {
    if (speechSynth) {
        speechSynth.cancel();
    }
    isSpeaking = false;
    stopBtn.classList.add('hidden');
}

async function readArticle(pageid, title) {
    // Stop any current speech
    cancelCurrentSpeech();

    // Highlight selected article
    document.querySelectorAll('.article-card').forEach(card => {
        card.classList.remove('active');
    });
    const activeCard = document.querySelector(`[data-pageid="${pageid}"]`);
    if (activeCard) {
        activeCard.classList.add('active');
    }

    showStatus(`Loading content for: ${title}...`, 'info');

    try {
        // Fetch full article extract
        const url = `https://en.wikipedia.org/w/api.php?` +
            `action=query&` +
            `prop=extracts&` +
            `exintro=&` +
            `explaintext=&` +
            `pageids=${pageid}&` +
            `format=json&` +
            `origin=*`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.pages && data.query.pages[pageid]) {
            const page = data.query.pages[pageid];
            const text = page.extract;

            if (text) {
                // Sanitize title for display
                const sanitizedTitle = title.replace(/[<>]/g, '');

                // Find the article in nearbyArticles to get location data
                const article = nearbyArticles.find(a => a.pageid == pageid);
                let directionIntro = '';

                if (article && currentPosition) {
                    const { latitude, longitude } = currentPosition.coords;
                    const distance = calculateDistance(latitude, longitude, article.lat, article.lon);
                    const bearing = calculateBearing(latitude, longitude, article.lat, article.lon);
                    const direction = bearingToCompassDirection(bearing);
                    const distanceText = formatDistance(distance);

                    directionIntro = `${distanceText} to your ${direction} is `;
                }

                showStatus(`Reading: ${sanitizedTitle} (${currentArticleIndex + 1}/${nearbyArticles.length})`, 'success');
                speakText(`${directionIntro}${sanitizedTitle}. ${text}`);
            } else {
                showStatus('No content available for this article', 'error');
                // Auto-advance to next article if in auto-play mode
                if (autoPlayMode) {
                    advanceToNextArticle();
                }
            }
        } else {
            showStatus('Could not load article content', 'error');
            // Auto-advance to next article if in auto-play mode
            if (autoPlayMode) {
                advanceToNextArticle();
            }
        }
    } catch (error) {
        showStatus('Error loading article: ' + error.message, 'error');
        // Auto-advance to next article if in auto-play mode
        if (autoPlayMode) {
            advanceToNextArticle();
        }
    }
}

function advanceToNextArticle() {
    if (!autoPlayMode || !nearbyArticles.length) return;

    // Move to next article
    currentArticleIndex++;

    if (currentArticleIndex >= nearbyArticles.length) {
        // Reached the end, stop the tour
        showStatus('Completed tour of all places.', 'success');
        currentArticleIndex = nearbyArticles.length - 1; // Stay at last article
        return;
    }

    const nextArticle = nearbyArticles[currentArticleIndex];
    setTimeout(() => {
        readArticle(nextArticle.pageid, nextArticle.title);
    }, ARTICLE_PAUSE_MS); // Pause between articles
}

function speakText(text) {
    if (!speechSynth) {
        showStatus('Text-to-speech is not supported in your browser', 'error');
        return;
    }

    // Cancel any ongoing speech
    cancelCurrentSpeech();

    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.rate = 0.9;
    currentUtterance.pitch = 1;
    currentUtterance.volume = 1;

    currentUtterance.onstart = () => {
        isSpeaking = true;
        stopBtn.classList.remove('hidden');
    };

    currentUtterance.onend = () => {
        isSpeaking = false;
        stopBtn.classList.add('hidden');
        showStatus('Finished reading', 'success');

        // Auto-advance to next article if in auto-play mode
        if (autoPlayMode) {
            advanceToNextArticle();
        }
    };

    currentUtterance.onerror = (event) => {
        isSpeaking = false;
        stopBtn.classList.add('hidden');
        showStatus('Error with speech synthesis: ' + event.error, 'error');
    };

    speechSynth.speak(currentUtterance);
}

function stopSpeaking() {
    cancelCurrentSpeech();

    // Remove active state from all cards
    document.querySelectorAll('.article-card').forEach(card => {
        card.classList.remove('active');
    });

    showStatus('Reading stopped', 'info');
}

// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
