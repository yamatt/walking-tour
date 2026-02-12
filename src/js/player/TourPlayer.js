import {
    ARTICLE_PAUSE_MS,
    SPEECH_CANCEL_DELAY_MS,
    SPEECH_RESUME_CHECK_DELAY_MS,
    SPEECH_MONITOR_INTERVAL_MS,
    SPEECH_CHUNK_MAX_CHARS
} from '../config.js';
import { fetchArticleExtract } from '../services/wikiApi.js';

// TourPlayer Class - Manages all playback logic
class TourPlayer {
        // Internal debug logger
        _logDebug(...args) {
            // You can enhance this to use a custom logger or UI panel if desired
            if (window && window.console) {
                console.debug('[TourPlayer]', ...args);
            }
        }
    constructor() {
        this.currentIndex = 0;
        this.isPlaying = false;
        this.autoPlayEnabled = true;
        this.manuallyStopped = false;
        this.isFirefox = /firefox/i.test(navigator.userAgent);

        // Speech synthesis
        this.speechSynth = window.speechSynthesis;
        this.currentUtterance = null;
        this.voices = [];
        this.voicesLoaded = false;
        // Monitoring
        this.monitorInterval = null;
        this.speechStartTime = null;
        this.expectedDuration = null;
        this.speechChunks = [];
        this.chunkIndex = 0;
        this.lastChunkEndTime = null;
        this.isChunking = false;
        this.playbackId = 0;
        this.activePlayId = 0;

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
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            this._stopSilentAudio();

            const buffer = this.audioContext.createBuffer(1, this.audioContext.sampleRate, this.audioContext.sampleRate);

            this.silentSource = this.audioContext.createBufferSource();
            this.silentSource.buffer = buffer;
            this.silentSource.loop = true;
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
        this.activePlayId = 0;
        this._cancelSpeech();
        this._clearMonitoring();
        this._stopSilentAudio();
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
        const playId = ++this.playbackId;
        this.activePlayId = playId;
        this._cancelSpeech();
        this.manuallyStopped = false;

        if (this.onTrackChange) {
            this.onTrackChange(article, this.currentIndex, this.queue.length);
        }

        try {
            const text = await fetchArticleExtract(article.pageid);

            if (!text) {
                throw new Error('No content available');
            }

            let speechText = article.title + '. ' + text;
            if (article._locationContext) {
                speechText = article._locationContext + speechText;
            }

            this._updateMediaMetadata(article.title);

            await this._speak(speechText, playId);
        } catch (error) {
            console.error('TourPlayer: Error playing article:', error);
            if (this.onError) {
                this.onError(error.message);
            }

            if (this.autoPlayEnabled && !this.manuallyStopped) {
                this._scheduleNext();
            } else {
                this._stopSilentAudio();
            }
        }
    }

    // Speak text using speech synthesis
    _speak(text, playId) {
        return new Promise((resolve, reject) => {
            if (!this.speechSynth) {
                console.error('TourPlayer: Speech synthesis not supported');
                reject(new Error('Speech synthesis not supported'));
                return;
            }

            const currentPlayId = playId ?? this.playbackId;

            console.log('TourPlayer: Preparing to speak, text length:', text.length);
            console.log('TourPlayer: speechSynth.speaking:', this.speechSynth.speaking);
            console.log('TourPlayer: speechSynth.pending:', this.speechSynth.pending);

            setTimeout(() => {
                if (this.voices.length === 0) {
                    this.voices = this.speechSynth.getVoices();
                    console.log('TourPlayer: Reloaded voices, count:', this.voices.length);
                }
                // If still no voices, show a visible error and skip
                if (this.voices.length === 0) {
                    if (this.onError) {
                        this.onError('Speech system not ready. Please tap Start again or reload the page.');
                    }
                    reject(new Error('No speech voices available'));
                    return;
                }

                this.speechChunks = this._buildSpeechChunks(text, SPEECH_CHUNK_MAX_CHARS);
                this.chunkIndex = 0;
                this.lastChunkEndTime = null;
                this.isChunking = this.speechChunks.length > 1;

                console.log('TourPlayer: Speech chunks:', this.speechChunks.length);

                if (this.speechChunks.length === 0) {
                    reject(new Error('Speech text is empty'));
                    return;
                }

                this.expectedDuration = this._estimateDuration(text);
                console.log('TourPlayer: Expected duration:', this.expectedDuration, 'ms');

                const speakChunk = (index) => {
                    if (this.manuallyStopped) {
                        console.log('TourPlayer: Speech manually stopped, resolving.');
                        resolve();
                        return;
                    }

                    if (currentPlayId !== this.playbackId) {
                        console.log('TourPlayer: PlayId changed, resolving.');
                        resolve();
                        return;
                    }

                    const chunkText = this.speechChunks[index];
                    this.chunkIndex = index;

                    this.currentUtterance = new SpeechSynthesisUtterance(chunkText);
                    this.currentUtterance.rate = 0.9;
                    this.currentUtterance.pitch = 1;
                    this.currentUtterance.volume = 1;

                    this._selectVoice(this.currentUtterance);
                    console.log('TourPlayer: Selected voice:', this.currentUtterance.voice?.name, this.currentUtterance.lang);

                    this.currentUtterance.onstart = () => {
                        if (currentPlayId !== this.playbackId) return;
                        if (index === 0) {
                            this.isPlaying = true;
                            this.speechStartTime = Date.now();
                            this._updateState(true);
                            this._startMonitoring();
                            this._startSilentAudio();
                            console.log('TourPlayer: ✓ Speech STARTED successfully');
                        } else {
                            console.log('TourPlayer: ✓ Speech chunk started', index + 1, '/', this.speechChunks.length);
                        }
                    };

                    this.currentUtterance.onend = () => {
                        if (currentPlayId !== this.playbackId) {
                            console.log('TourPlayer: onend: PlayId changed, resolving.');
                            resolve();
                            return;
                        }
                        this.lastChunkEndTime = Date.now();
                        if (index < this.speechChunks.length - 1) {
                            console.log('TourPlayer: Speech chunk ended, moving to next chunk', index + 2);
                            setTimeout(() => speakChunk(index + 1), 0);
                            return;
                        }

                        console.log('TourPlayer: ✓ Speech ENDED normally, calling _handleSpeechEnd');
                        this._handleSpeechEnd(currentPlayId);
                        resolve();
                    };

                    this.currentUtterance.onerror = (event) => {
                        if (currentPlayId !== this.playbackId) {
                            console.log('TourPlayer: onerror: PlayId changed, resolving.');
                            resolve();
                            return;
                        }
                        console.error('TourPlayer: ✗ Speech ERROR:', event.error, event);
                        this.isPlaying = false;
                        this._clearMonitoring();
                        this._updateState(false);

                        if (event.error !== 'canceled') {
                            console.log('TourPlayer: Speech error not canceled, rejecting and advancing.');
                            reject(new Error(event.error));
                        } else {
                            console.log('TourPlayer: Speech error canceled, resolving.');
                            resolve();
                        }
                    };

                    const _startSpeaking = () => {
                        console.log('TourPlayer: Calling speechSynth.speak()');
                        this.speechSynth.speak(this.currentUtterance);
                        console.log('TourPlayer: speechSynth.speak() called, now speaking:', this.speechSynth.speaking);

                        setTimeout(() => {
                            console.log('TourPlayer: Post-speak check - speaking:', this.speechSynth.speaking, 'paused:', this.speechSynth.paused);
                            if (this.speechSynth.paused) {
                                console.log('TourPlayer: Speech is paused, resuming...');
                                this.speechSynth.resume();
                            }
                            if (!this.speechSynth.speaking && !this.isPlaying && index === 0 && currentPlayId === this.playbackId) {
                                if (this.isFirefox) {
                                    console.warn('TourPlayer: Speech start status unclear (Firefox), continuing');
                                } else {
                                    console.error('TourPlayer: Speech failed to start!');
                                    if (this.onError) {
                                        this.onError('Speech failed to start. Please tap Start again or reload the page.');
                                    }
                                    reject(new Error('Speech failed to start'));
                                }
                            }
                        }, SPEECH_RESUME_CHECK_DELAY_MS);
                    };

                    if (this.speechSynth.pending || this.speechSynth.speaking) {
                        console.log('TourPlayer: Canceling existing speech');
                        this.speechSynth.cancel();
                        setTimeout(() => _startSpeaking(), 100);
                    } else {
                        _startSpeaking();
                    }
                };

                speakChunk(0);

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
        const adjustedWPM = 150 * 0.9;
        return (words / adjustedWPM) * 60 * 1000;
    }

    // Split long text into smaller chunks for more reliable playback
    _buildSpeechChunks(text, maxLength) {
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized) return [];
        if (normalized.length <= maxLength) return [normalized];

        const sentenceMatches = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
        const chunks = [];
        let current = '';

        sentenceMatches.forEach((sentence) => {
            const trimmed = sentence.trim();
            if (!trimmed) return;

            if ((current + ' ' + trimmed).trim().length <= maxLength) {
                current = current ? `${current} ${trimmed}` : trimmed;
                return;
            }

            if (current) {
                chunks.push(current);
                current = '';
            }

            if (trimmed.length <= maxLength) {
                current = trimmed;
                return;
            }

            let segment = '';
            trimmed.split(' ').forEach((word) => {
                if (!word) return;
                if ((segment + ' ' + word).trim().length <= maxLength) {
                    segment = segment ? `${segment} ${word}` : word;
                } else {
                    if (segment) chunks.push(segment);
                    segment = word;
                }
            });

            if (segment) {
                current = segment;
            }
        });

        if (current) chunks.push(current);
        return chunks;
    }

    // Cancel current speech
    _cancelSpeech() {
        if (this.speechSynth) {
            this.speechSynth.cancel();
        }
        this.currentUtterance = null;
        this.speechChunks = [];
        this.chunkIndex = 0;
        this.lastChunkEndTime = null;
        this.isChunking = false;
    }

    // Handle speech ending
    _handleSpeechEnd(playId) {
        if (playId && playId !== this.playbackId) {
            this._logDebug('_handleSpeechEnd: playId changed, not advancing.');
            return;
        }
        this.isPlaying = false;
        this._updateState(false);
        this._clearMonitoring();

        if (this.autoPlayEnabled && !this.manuallyStopped) {
            this._logDebug('_handleSpeechEnd: autoPlayEnabled and not manuallyStopped, calling _scheduleNext');
            this._scheduleNext();
        } else {
            this._logDebug('_handleSpeechEnd: NOT autoPlayEnabled or manuallyStopped, not advancing.');
        }
    }

    // Schedule next track
    _scheduleNext() {
        this._logDebug('_scheduleNext: called. Queue length:', this.queue.length, 'Current index:', this.currentIndex);
        setTimeout(() => {
            if (this.currentIndex < this.queue.length - 1) {
                this._logDebug('_scheduleNext: Advancing to next article.');
                this.currentIndex++;
                this.play();
            } else {
                this._logDebug('_scheduleNext: Reached end of queue.');
                this._stopSilentAudio();
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

        if (this.isChunking && this.lastChunkEndTime) {
            const sinceChunkEnd = Date.now() - this.lastChunkEndTime;
            if (sinceChunkEnd < 1500) return;
        }

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
        if (this.currentIndex >= articles.length && articles.length > 0) {
            this.currentIndex = articles.length - 1;
        }
    }

}


export default TourPlayer;
