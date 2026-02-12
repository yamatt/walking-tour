export async function fetchNearbyArticles(lat, lon, options = {}) {
    const radius = options.radius ?? 10000;
    const limit = options.limit ?? 10;

    const url = `https://en.wikipedia.org/w/api.php?` +
        `action=query&` +
        `list=geosearch&` +
        `gscoord=${lat}|${lon}&` +
        `gsradius=${radius}&` +
        `gslimit=${limit}&` +
        `format=json&` +
        `origin=*`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.query && data.query.geosearch) {
        return data.query.geosearch;
    }

    return [];
}

export async function fetchArticleExtract(pageid) {
    const url = `https://en.wikipedia.org/w/api.php?` +
        `action=query&` +
        `prop=extracts&exintro=&explaintext=&` +
        `pageids=${pageid}&format=json&origin=*`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.query && data.query.pages && data.query.pages[pageid]) {
        return data.query.pages[pageid].extract;
    }

    return null;
}

export async function fetchArticleSnippet(pageid, sentences = 2) {
    const url = `https://en.wikipedia.org/w/api.php?` +
        `action=query&` +
        `prop=extracts&` +
        `exintro=&` +
        `explaintext=&` +
        `exsentences=${sentences}&` +
        `pageids=${pageid}&` +
        `format=json&` +
        `origin=*`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.query && data.query.pages && data.query.pages[pageid]) {
        return data.query.pages[pageid].extract || null;
    }

    return null;
}

export async function fetchArticleImages(pageids, options = {}) {
    const thumbSize = options.thumbSize ?? 300;
    const imageLimit = options.imageLimit ?? 5;
    const imageMap = new Map();

    if (!pageids || pageids.length === 0) return imageMap;

    const url = `https://en.wikipedia.org/w/api.php?` +
        `action=query&` +
        `prop=pageimages|images&` +
        `piprop=thumbnail&` +
        `pithumbsize=${thumbSize}&` +
        `imlimit=${imageLimit}&` +
        `pageids=${pageids.join('|')}&` +
        `format=json&` +
        `origin=*`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.query || !data.query.pages) return imageMap;

    const pages = Object.values(data.query.pages);

    pages.forEach((page) => {
        if (page.thumbnail && page.thumbnail.source) {
            imageMap.set(page.pageid, page.thumbnail.source);
        }
    });

    const pagesWithoutThumbnails = pages.filter(
        (page) => !page.thumbnail && page.images && page.images.length > 0
    );

    for (const page of pagesWithoutThumbnails) {
        const contentImage = page.images.find((img) => {
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

        if (!contentImage) continue;

        const fallbackUrl = await fetchSingleImageInfo(page.pageid, contentImage.title, thumbSize);
        if (fallbackUrl) {
            imageMap.set(page.pageid, fallbackUrl);
        }
    }

    return imageMap;
}

async function fetchSingleImageInfo(pageid, imageTitle, thumbSize) {
    const url = `https://en.wikipedia.org/w/api.php?` +
        `action=query&` +
        `titles=${encodeURIComponent(imageTitle)}&` +
        `prop=imageinfo&` +
        `iiprop=url&` +
        `iiurlwidth=${thumbSize}&` +
        `format=json&` +
        `origin=*`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.query && data.query.pages) {
        const page = Object.values(data.query.pages)[0];
        if (page.imageinfo && page.imageinfo[0]) {
            return page.imageinfo[0].thumburl || page.imageinfo[0].url || null;
        }
    }

    return null;
}
