// Import styles
import './styles.css';

// Configuration constants
const LOCATION_CHECK_INTERVAL_MS = 30000; // 30 seconds between location checks
const ARTICLE_SWITCH_THRESHOLD_METERS = 100; // Switch to nearer article if 100m closer
const ARTICLE_PAUSE_MS = 2000; // 2 second pause between articles
const DOUBLE_TAP_THRESHOLD_MS = 500; // Double-tap detection window in milliseconds
const SPEECH_CANCEL_DELAY_MS = 200; // Delay after cancel before new speech
const SPEECH_RESUME_CHECK_DELAY_MS = 100; // Delay before checking if resume needed
const SPEECH_MONITOR_INTERVAL_MS = 2000; // How often to check speech status

// =============================================================================
// TourPlayer Class - Manages all playback logic
// =============================================================================
class TourPlayer {
    constructor() {
        this.queue = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.autoPlayEnabled = true;
        this.manuallyStopped = false;

        // Speech synthesis
        this.speechSynth = window.speechSynthesis;
        this.currentUtterance = null;
        this.voices = [];
        this.voicesLoaded = false;

        // Monitoring
        this.monitorInterval = null;
        this.speechStartTime = null;
        this.expectedDuration = null;

        // Web Audio API for keeping page active when locked
        this.audioContext = null;
        this.silentSource = null;

        // Callbacks
        this.onStateChange = null;
        this.onTrackChange = null;
        this.onError = null;

        // Initialize
        this._initializeVoices();
        this._initializeAudioContext();
        this._setupMediaSession();
        this._setupVisibilityHandler();
    }

    // Initialize Web Audio API context for keeping page active
    _initializeAudioContext() {
        try {
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            console.log('TourPlayer: Audio context initialized');
        } catch (error) {
            console.warn('TourPlayer: Web Audio API not available:', error);
        }
    }

    // Start playing silent audio to keep page active (prevents throttling when locked)
    _startSilentAudio() {
        if (!this.audioContext) return;

        try {
            // Resume context if suspended (required on some browsers)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            // Stop any existing silent audio
            this._stopSilentAudio();

            // Create a silent audio buffer (1 second of silence)
            const buffer = this.audioContext.createBuffer(1, this.audioContext.sampleRate, this.audioContext.sampleRate);

            // Create and configure source
            this.silentSource = this.audioContext.createBufferSource();
            this.silentSource.buffer = buffer;
            this.silentSource.loop = true; // Loop the silent audio
            this.silentSource.connect(this.audioContext.destination);
            this.silentSource.start();

            console.log('TourPlayer: Silent audio started (keeps page active when locked)');
        } catch (error) {
            console.warn('TourPlayer: Could not start silent audio:', error);
        }
    }

    // Stop silent audio
    _stopSilentAudio() {
        if (this.silentSource) {
            try {
                this.silentSource.stop();
                this.silentSource.disconnect();
            } catch (error) {
                // Ignore errors if already stopped
            }
            this.silentSource = null;
            console.log('TourPlayer: Silent audio stopped');
        }
    }

    // Initialize speech synthesis voices
    _initializeVoices() {
        if (!this.speechSynth) return;

        const loadVoices = () => {
            this.voices = this.speechSynth.getVoices();
            if (this.voices.length > 0) {
                this.voicesLoaded = true;
                console.log('TourPlayer: Voices loaded:', this.voices.length);
            }
        };

        loadVoices();

        if (this.speechSynth.onvoiceschanged !== undefined) {
            this.speechSynth.onvoiceschanged = loadVoices;
        }

        setTimeout(() => {
            if (!this.voicesLoaded) loadVoices();
        }, 100);
    }

    // Setup media session for headphone controls
    _setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
        navigator.mediaSession.setActionHandler('play', () => this.play());
        navigator.mediaSession.setActionHandler('pause', () => this.stop());
    }

    // Setup visibility change handler
    _setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isPlaying) {
                this._checkSpeechStatus();
            }
        });
    }

    // Load queue of articles
    loadQueue(articles) {
        this.queue = articles;
        this.currentIndex = 0;
        console.log('TourPlayer: Queue loaded with', articles.length, 'items');
    }

    // Play current track
    play() {
        if (this.queue.length === 0) {
            console.warn('TourPlayer: Cannot play, queue is empty');
            return;
        }

        if (this.currentIndex >= this.queue.length) {
            this.currentIndex = 0;
        }

        const article = this.queue[this.currentIndex];
        this._playArticle(article);
    }

    // Play specific track by index
    playTrack(index) {
        if (index < 0 || index >= this.queue.length) {
            console.warn('TourPlayer: Invalid track index:', index);
            return;
        }

        this.currentIndex = index;
        this.play();
    }

    // Stop playback
    stop() {
        this.manuallyStopped = true;
        this._cancelSpeech();
        this._clearMonitoring();
        this._stopSilentAudio(); // Stop keeping page active
        this._updateState(false);
        console.log('TourPlayer: Stopped');
    }

    // Go to next track
    next() {
        if (this.currentIndex < this.queue.length - 1) {
            this.currentIndex++;
            this.play();
        } else {
            console.log('TourPlayer: At end of queue');
        }
    }

    // Go to previous track
    previous() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.play();
        } else {
            console.log('TourPlayer: At start of queue');
        }
    }

    // Play article with location context
    async _playArticle(article) {
        this._cancelSpeech();
        this.manuallyStopped = false;

        // Notify track change (will be updated with location context by callback)
        if (this.onTrackChange) {
            this.onTrackChange(article, this.currentIndex, this.queue.length);
        }

        try {
            // Fetch article content
            const text = await this._fetchArticleContent(article.pageid);

            if (!text) {
                throw new Error('No content available');
            }

            // Build speech text with location intro if available (added by onTrackChange callback)
            let speechText = article.title + '. ' + text;
            if (article._locationContext) {
                speechText = article._locationContext + speechText;
            }

            // Update media session metadata
            this._updateMediaMetadata(article.title);

            // Speak the text
            await this._speak(speechText);

        } catch (error) {
            console.error('TourPlayer: Error playing article:', error);
            if (this.onError) {
                this.onError(error.message);
            }

            // Auto-advance on error if enabled
            if (this.autoPlayEnabled && !this.manuallyStopped) {
                this._scheduleNext();
            } else {
                // Not continuing, stop silent audio
                this._stopSilentAudio();
            }
        }
    }

    // Fetch article content from Wikipedia
    async _fetchArticleContent(pageid) {
        const url = `https://en.wikipedia.org/w/api.php?` +
            `action=query&prop=extracts&exintro=&explaintext=&` +
            `pageids=${pageid}&format=json&origin=*`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.pages && data.query.pages[pageid]) {
            return data.query.pages[pageid].extract;
        }
        return null;
    }

    // Speak text using speech synthesis
    _speak(text) {
        return new Promise((resolve, reject) => {
            if (!this.speechSynth) {
                console.error('TourPlayer: Speech synthesis not supported');
                reject(new Error('Speech synthesis not supported'));
                return;
            }

            console.log('TourPlayer: Preparing to speak, text length:', text.length);
            console.log('TourPlayer: speechSynth.speaking:', this.speechSynth.speaking);
            console.log('TourPlayer: speechSynth.pending:', this.speechSynth.pending);

            // Delay to ensure clean state after cancel
            setTimeout(() => {
                // Re-check voices
                if (this.voices.length === 0) {
                    this.voices = this.speechSynth.getVoices();
                    console.log('TourPlayer: Reloaded voices, count:', this.voices.length);
                }

                this.currentUtterance = new SpeechSynthesisUtterance(text);
                this.currentUtterance.rate = 0.9;
                this.currentUtterance.pitch = 1;
                this.currentUtterance.volume = 1;

                // Select voice
                this._selectVoice(this.currentUtterance);
                console.log('TourPlayer: Selected voice:', this.currentUtterance.voice?.name, this.currentUtterance.lang);

                // Track timing
                this.expectedDuration = this._estimateDuration(text);
                console.log('TourPlayer: Expected duration:', this.expectedDuration, 'ms');

                // Event handlers
                this.currentUtterance.onstart = () => {
                    this.isPlaying = true;
                    this.speechStartTime = Date.now();
                    this._updateState(true);
                    this._startMonitoring();
                    this._startSilentAudio(); // Keep page active when locked
                    console.log('TourPlayer: ✓ Speech STARTED successfully');
                };

                this.currentUtterance.onend = () => {
                    console.log('TourPlayer: ✓ Speech ENDED normally');
                    this._handleSpeechEnd();
                    resolve();
                };

                this.currentUtterance.onerror = (event) => {
                    console.error('TourPlayer: ✗ Speech ERROR:', event.error, event);
                    this.isPlaying = false;
                    this._clearMonitoring();
                    this._updateState(false);

                    if (event.error !== 'canceled') {
                        reject(new Error(event.error));
                    } else {
                        resolve();
                    }
                };

                // Define start speaking function
                const _startSpeaking = () => {
                    console.log('TourPlayer: Calling speechSynth.speak()');
                    this.speechSynth.speak(this.currentUtterance);
                    console.log('TourPlayer: speechSynth.speak() called, now speaking:', this.speechSynth.speaking);

                    // Chrome Android fix - check if paused and resume
                    setTimeout(() => {
                        console.log('TourPlayer: Post-speak check - speaking:', this.speechSynth.speaking, 'paused:', this.speechSynth.paused);
                        if (this.speechSynth.paused) {
                            console.log('TourPlayer: Speech is paused, resuming...');
                            this.speechSynth.resume();
                        }
                        // If speech hasn't started, it might have failed silently
                        if (!this.speechSynth.speaking && !this.isPlaying) {
                            console.error('TourPlayer: Speech failed to start!');
                            reject(new Error('Speech failed to start'));
                        }
                    }, SPEECH_RESUME_CHECK_DELAY_MS);
                };

                // Ensure clean state
                if (this.speechSynth.pending || this.speechSynth.speaking) {
                    console.log('TourPlayer: Canceling existing speech');
                    this.speechSynth.cancel();
                    // Extra delay after cancel for Chrome
                    setTimeout(() => _startSpeaking(), 100);
                } else {
                    _startSpeaking();
                }

            }, SPEECH_CANCEL_DELAY_MS);
        });
    }

    // Select appropriate voice
_selectVoice(utterance) {
        if (this.voices.length > 0) {
            const englishVoice = this.voices.find(v => v.lang.startsWith('en'));
            if (englishVoice) {
                utterance.voice = englishVoice;
                utterance.lang = englishVoice.lang;
            } else {
                utterance.voice = this.voices[0];
                utterance.lang = this.voices[0].lang;
            }
        } else {
            utterance.lang = 'en-US';
        }
    }

    // Estimate speech duration
    _estimateDuration(text) {
        const words = text.split(/\s+/).length;
        const adjustedWPM = 150 * 0.9; // 150 WPM * 0.9 rate
        return (words / adjustedWPM) * 60 * 1000;
    }

    // Cancel current speech
    _cancelSpeech() {
        if (this.speechSynth) {
            this.speechSynth.cancel();
        }
        this.currentUtterance = null;
    }

    // Handle speech ending
    _handleSpeechEnd() {
        this.isPlaying = false;
        this._updateState(false);
        this._clearMonitoring();

        // Auto-advance if enabled and not manually stopped
        if (this.autoPlayEnabled && !this.manuallyStopped) {
            this._scheduleNext();
        }
    }

    // Schedule next track
    _scheduleNext() {
        setTimeout(() => {
            if (this.currentIndex < this.queue.length - 1) {
                this.currentIndex++;
                this.play();
            } else {
                console.log('TourPlayer: Reached end of queue');
                this._stopSilentAudio(); // Stop keeping page active
                if (this.onStateChange) {
                    this.onStateChange({
                        playing: false,
                        completed: true,
                        message: 'Completed tour of all places.'
                    });
                }
            }
        }, ARTICLE_PAUSE_MS);
    }

    // Start monitoring speech status
    _startMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }

        this.monitorInterval = setInterval(() => {
            this._checkSpeechStatus();
        }, SPEECH_MONITOR_INTERVAL_MS);
    }

    // Check if speech has actually finished
    _checkSpeechStatus() {
        if (this.manuallyStopped) return;

        const isActuallySpeaking = this.speechSynth && this.speechSynth.speaking;

        if (this.isPlaying && !isActuallySpeaking) {
            console.log('TourPlayer: Speech ended in background');
            this._handleSpeechEnd();
        } else if (this.isPlaying && this.speechStartTime && this.expectedDuration) {
            const elapsed = Date.now() - this.speechStartTime;
            if (elapsed > this.expectedDuration + 5000) {
                console.log('TourPlayer: Speech timeout');
                this._handleSpeechEnd();
            }
        }
    }

    // Clear monitoring interval
    _clearMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    // Update media session metadata
    _updateMediaMetadata(title) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: `Walking Tour (${this.currentIndex + 1}/${this.queue.length})`,
                album: 'Nearby Places'
            });
        }
    }

    // Notify state change
    _updateState(playing) {
        if (this.onStateChange) {
            this.onStateChange({
                playing,
                currentIndex: this.currentIndex,
                queueLength: this.queue.length
            });
        }
    }

    // Get current article
    getCurrentArticle() {
        return this.queue[this.currentIndex] || null;
    }

    // Check if playing
    getIsPlaying() {
        return this.isPlaying;
    }

    // Update queue and adjust if playing
    updateQueue(articles) {
        this.queue = articles;
        // Ensure current index is still valid
        if (this.currentIndex >= articles.length && articles.length > 0) {
            this.currentIndex = articles.length - 1;
        }
    }
}

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

// Setup player callbacks
tourPlayer.onStateChange = (state) => {
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

tourPlayer.onTrackChange = (article, index, total) => {
    // Update UI
    showStatus(`Reading: ${article.title} (${index + 1}/${total})`, 'success');

    // Add location context if available
    if (currentPosition) {
        const { latitude, longitude } = currentPosition.coords;
        const distance = calculateDistance(latitude, longitude, article.lat, article.lon);
        const bearing = calculateBearing(latitude, longitude, article.lat, article.lon);
        const direction = bearingToCompassDirection(bearing);
        const distanceText = formatDistance(distance);

        const locationContext = `${distanceText} to your ${direction} is `;
        // Update the article with location context for the player
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

// Initialize event listeners
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

    // Prevent zoom on double-tap for buttons (mobile)
    preventDoubleTapZoom(startBtn);
    preventDoubleTapZoom(stopBtn);
    preventDoubleTapZoom(refreshBtn);

    // Stop playing when page is unloaded
    window.addEventListener('beforeunload', () => {
        tourPlayer.stop();
    });
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
        tourPlayer.loadQueue([]);
        showStatus('Refreshing nearby places...', 'info');
        fetchNearbyArticles(latitude, longitude);
    }
}

// =============================================================================
// Geographic Calculations
// =============================================================================
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

    // Update player queue with new order
    tourPlayer.updateQueue(nearbyArticles);

    // Check if we should switch to a nearer article
    if (tourPlayer.autoPlayEnabled && tourPlayer.getIsPlaying()) {
        const currentArticle = tourPlayer.getCurrentArticle();
        const nearestArticle = nearbyArticles[0];

        // If the nearest article is different and significantly closer (threshold)
        if (currentArticle && nearestArticle &&
            currentArticle.pageid !== nearestArticle.pageid &&
            nearestArticle.currentDist < currentArticle.currentDist - ARTICLE_SWITCH_THRESHOLD_METERS) {

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

            // Load queue into player and auto-start
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
        showStatus('Error fetching nearby places: ' + error.message, 'error');
        startBtn.disabled = false;
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

    // Preload snippets for faster updates
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

async function fetchArticleImages(pageids) {
    try {
        // First try to fetch thumbnails (pageimages)
        const url = `https://en.wikipedia.org/w/api.php?` +
            `action=query&` +
            `prop=pageimages|images&` +
            `piprop=thumbnail&` +
            `pithumbsize=300&` +
            `imlimit=5&` +
            `pageids=${pageids.join('|')}&` +
            `format=json&` +
            `origin=*`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.pages) {
            // First pass: add thumbnails where available
            Object.values(data.query.pages).forEach(page => {
                if (page.thumbnail) {
                    imageCache.set(page.pageid, page.thumbnail.source);
                    if (currentArticle && currentArticle.pageid === page.pageid) {
                        updateCurrentImageForArticle(page.pageid);
                    }
                }
            });

            // Second pass: for pages without thumbnails, try to get first image
            const pagesWithoutThumbnails = Object.values(data.query.pages).filter(
                page => !page.thumbnail && page.images && page.images.length > 0
            );

            if (pagesWithoutThumbnails.length > 0) {
                // Fetch details for first image of each page
                for (const page of pagesWithoutThumbnails) {
                    // Filter out common non-content images
                    const contentImage = page.images.find(img => {
                        const title = img.title.toLowerCase();
                        return !title.includes('commons-logo') &&
                               !title.includes('wiki') &&
                               !title.includes('edit') &&
                               !title.includes('padlock') &&
                               !title.includes('question_book') &&
                               !title.includes('ambox') &&
                               !title.includes('symbol') &&
                               !title.endsWith('.svg');
                    });

                    if (contentImage) {
                        await fetchSingleImageInfo(page.pageid, contentImage.title);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error fetching article images:', error);
    }
}

async function fetchSingleImageInfo(pageid, imageTitle) {
    try {
        const url = `https://en.wikipedia.org/w/api.php?` +
            `action=query&` +
            `titles=${encodeURIComponent(imageTitle)}&` +
            `prop=imageinfo&` +
            `iiprop=url&` +
            `iiurlwidth=300&` +
            `format=json&` +
            `origin=*`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.pages) {
            const page = Object.values(data.query.pages)[0];
            if (page.imageinfo && page.imageinfo[0]) {
                const imageUrl = page.imageinfo[0].thumburl || page.imageinfo[0].url;
                imageCache.set(pageid, imageUrl);
                if (currentArticle && currentArticle.pageid === pageid) {
                    updateCurrentImageForArticle(pageid);
                }
            }
        }
    } catch (error) {
        console.error('Error fetching single image info:', error);
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
            if (page.extract) {
                snippetCache.set(pageid, page.extract);
                if (currentArticle && currentArticle.pageid === pageid && currentSnippetDiv) {
                    currentSnippetDiv.textContent = page.extract;
                }
            }
        }
    } catch (error) {
        console.error('Error fetching snippet:', error);
    }
}

// =============================================================================
// App Initialization
// =============================================================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
