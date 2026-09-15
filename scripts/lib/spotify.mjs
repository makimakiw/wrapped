const PLAYLIST_ID = "1rBL2DEwVfa12UHVU1YvF4";

async function fetchTrackPreview(trackUri) {
  const id = trackUri.replace("spotify:track:", "");
  try {
    const res = await fetch(`https://open.spotify.com/embed/track/${id}`, {
      headers: { "User-Agent": "third-act-weekly-wrap/1.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const preview = html.match(/https:\/\/p\.scdn\.co\/mp3-preview\/[a-f0-9]+/)?.[0];
    if (!preview) return null;
    return { uri: trackUri, preview };
  } catch {
    return null;
  }
}

async function mapConcurrent(items, fn, concurrency = 12) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const result = await fn(items[idx]);
      if (result) out.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return out;
}

export async function fetchSpotifyPlaylist(playlistId = PLAYLIST_ID) {
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const res = await fetch(embedUrl, {
    headers: { "User-Agent": "third-act-weekly-wrap/1.0" },
  });
  if (!res.ok) {
    return {
      status: "error",
      playlistId,
      tracks: [],
      reason: `HTTP ${res.status}`,
    };
  }

  const html = await res.text();
  const uris = [...new Set(html.match(/spotify:track:[a-zA-Z0-9]+/g) ?? [])];
  const titleMatch = html.match(/CondensedMetadata_title__[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
  const title = titleMatch?.[1]?.trim() ?? null;

  console.log(`  Hämtar previews för ${uris.length} låtar…`);
  const tracks = await mapConcurrent(uris, fetchTrackPreview);

  return {
    status: tracks.length ? "ok" : "empty",
    playlistId,
    title,
    url: `https://open.spotify.com/playlist/${playlistId}`,
    tracks,
    trackCount: tracks.length,
  };
}
