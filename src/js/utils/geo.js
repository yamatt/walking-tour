export function calculateDistance(lat1, lon1, lat2, lon2) {
    // Haversine formula to calculate distance between two coordinates
    const R = 6371000; // Earth's radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

export function calculateBearing(lat1, lon1, lat2, lon2) {
    // Calculate bearing from point 1 to point 2
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
              Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

    const theta = Math.atan2(y, x);
    return (theta * 180 / Math.PI + 360) % 360; // Convert to degrees
}

export function bearingToCompassDirection(bearing) {
    // Convert bearing (0-360 degrees) to compass direction
    const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
}

export function formatDistance(meters) {
    // Format distance for speech
    if (meters < 1000) {
        return `${Math.round(meters)} meters`;
    }

    const km = (meters / 1000).toFixed(1);
    return `${km} kilometers`;
}
