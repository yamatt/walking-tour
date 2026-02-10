# Walking Tour 🚶

A web app that acts as your personal walking tour guide. As you walk around, it uses your location to discover nearby Wikipedia articles and reads them out loud using text-to-speech.

![Walking Tour Screenshot](https://github.com/user-attachments/assets/73d0488e-03db-4257-bc74-00b79127aecf)

## Features

- 📍 **Geolocation**: Automatically detects your current location
- 🌍 **Wikipedia Integration**: Finds nearby places and landmarks within 10km using Wikipedia's geosearch API
- 🔊 **Text-to-Speech**: Reads Wikipedia article content out loud using the Web Speech API
- 📱 **Mobile-Friendly**: Responsive design that works great on phones and tablets
- 🎨 **Modern UI**: Beautiful gradient design with smooth animations

## How to Use

1. Open the app in your web browser
2. Click **"Start Tour"** and allow location access when prompted
3. The app will display nearby places with their distances
4. Click on any place to hear its Wikipedia article read aloud
5. Use **"Stop Reading"** to pause the narration
6. Use **"Refresh Nearby Places"** to update the list

## Live Demo

Visit: [https://yamatt.github.io/walking-tour/](https://yamatt.github.io/walking-tour/)

## Local Development

Simply open `index.html` in a modern web browser. For best results:

```bash
# Serve locally with Python
python3 -m http.server 8000

# Then visit http://localhost:8000
```

## Browser Compatibility

Requires a modern browser with support for:
- Geolocation API
- Fetch API
- Web Speech API (for text-to-speech)

Tested on:
- Chrome/Edge (recommended)
- Firefox
- Safari (iOS and macOS)

## Privacy

- Your location is used only to find nearby articles and is not stored or transmitted anywhere except to Wikipedia's public API
- All processing happens in your browser
- No tracking or analytics

## Technology Stack

- Pure HTML, CSS, and JavaScript (no dependencies)
- Wikipedia API for geosearch and article content
- Browser Geolocation API
- Web Speech API for text-to-speech

## License

See [LICENSE](LICENSE) file for details.
