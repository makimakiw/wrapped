const PLAYLIST_ID = "1rBL2DEwVfa12UHVU1YvF4";

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

  return {
    status: uris.length ? "ok" : "empty",
    playlistId,
    title,
    url: `https://open.spotify.com/playlist/${playlistId}`,
    tracks: uris,
    trackCount: uris.length,
  };
}
