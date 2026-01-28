/**
 * YouTube Transcript Extraction Module
 * Multi-fallback strategy for extracting transcripts from YouTube videos.
 */

const TranscriptExtractor = (() => {
  /**
   * Format seconds into HH:MM:SS or MM:SS timestamp
   */
  function formatTimestamp(totalSeconds) {
    const seconds = Math.floor(totalSeconds);
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  /**
   * Decode HTML entities in transcript text
   */
  function decodeHTMLEntities(text) {
    const el = document.createElement("div");
    el.innerHTML = text;
    return el.textContent || "";
  }

  /**
   * Extract video ID from the current URL
   */
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
  }

  /**
   * Get caption tracks from the page's player response data.
   * Glasp's approach: split page source on "captions": to find captionTracks.
   */
  async function getCaptionTracks(videoId) {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await response.text();

    try {
      const split = html.split('"captions":');
      if (split.length < 2) return [];

      const captionsJson = split[1].split(',"videoDetails')[0].replace("\n", "");
      const captions = JSON.parse(captionsJson);
      return captions.playerCaptionsTracklistRenderer?.captionTracks || [];
    } catch {
      return [];
    }
  }

  /**
   * Method 1: Fetch transcript via caption track baseUrl
   * Parses the XML response from YouTube's timedtext endpoint.
   */
  async function fetchFromCaptionTrack(track) {
    if (!track?.baseUrl) throw new Error("No caption track URL");

    const response = await fetch(track.baseUrl);
    const xml = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const textNodes = doc.querySelectorAll("text");

    const entries = Array.from(textNodes)
      .map((node, index) => {
        const start = parseFloat(node.getAttribute("start") || "0");
        const text = decodeHTMLEntities(node.textContent || "").trim();
        return text ? { index, text, start: Math.round(start) } : null;
      })
      .filter(Boolean);

    if (entries.length === 0) throw new Error("No transcript entries found");
    return entries;
  }

  /**
   * Method 2: Fetch via YouTube's internal get_transcript API
   */
  async function fetchFromInternalAPI(videoId) {
    // First, get the transcript params from the page
    const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await pageResponse.text();

    // Extract serialized transcript params
    const paramsMatch = html.match(
      /"serializedShareEntity":"([^"]+)".*?"getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"]+)"/
    );

    let params;
    if (paramsMatch) {
      params = paramsMatch[2];
    } else {
      // Alternative: look for params in engagement panels
      const altMatch = html.match(/"params"\s*:\s*"([^"]+)"[^}]*"getTranscriptEndpoint"/);
      if (!altMatch) throw new Error("Could not find transcript params");
      params = altMatch[1];
    }

    const response = await fetch(
      "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20240101.00.00",
            },
          },
          params: params,
        }),
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const renderer =
      data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer
        ?.content?.transcriptSearchPanelRenderer;

    if (!renderer) throw new Error("Invalid transcript response");

    const segments =
      renderer?.body?.transcriptSegmentListRenderer?.initialSegments || [];

    const entries = segments
      .map((seg, index) => {
        const segment = seg?.transcriptSegmentRenderer;
        if (!segment) return null;

        const startMs = parseInt(segment.startMs || "0", 10);
        const text = (segment.snippet?.runs || [])
          .map((run) => run.text || "")
          .join("")
          .trim();

        return text
          ? { index, text, start: Math.round(startMs / 1000) }
          : null;
      })
      .filter(Boolean);

    if (entries.length === 0) throw new Error("No transcript entries found");
    return entries;
  }

  /**
   * Method 3: Scrape YouTube's built-in transcript panel from the DOM
   */
  async function fetchFromDOM() {
    // Click the "Show transcript" button if it exists
    const showBtn = document.querySelector(
      'button[aria-label="Show transcript"]'
    );
    if (showBtn) {
      showBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const segments = document.querySelectorAll(
      "#segments-container ytd-transcript-segment-renderer"
    );

    if (!segments || segments.length === 0) {
      throw new Error("No transcript segments found in DOM");
    }

    const entries = Array.from(segments)
      .map((seg, index) => {
        const timestampEl = seg.querySelector(
          ".segment-timestamp"
        );
        const textEl = seg.querySelector(".segment-text");

        if (!timestampEl || !textEl) return null;

        const timeText = timestampEl.textContent.trim();
        const text = textEl.textContent.trim();

        // Parse timestamp "M:SS" or "H:MM:SS" to seconds
        const parts = timeText.split(":").map(Number);
        let seconds = 0;
        if (parts.length === 3) {
          seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          seconds = parts[0] * 60 + parts[1];
        }

        return text ? { index, text, start: seconds } : null;
      })
      .filter(Boolean);

    if (entries.length === 0)
      throw new Error("No transcript entries extracted from DOM");
    return entries;
  }

  /**
   * Main extraction function with multi-fallback strategy.
   * Returns { entries, languages, selectedLang }
   */
  async function getTranscript(videoId, preferredLang = null) {
    if (!videoId) throw new Error("No video ID provided");

    const errors = [];

    // Method 1: Caption tracks
    try {
      const tracks = await getCaptionTracks(videoId);

      if (tracks.length > 0) {
        const languages = tracks.map((t) => ({
          code: t.languageCode,
          name: t.name?.simpleText || t.languageCode,
          isAuto: t.kind === "asr",
        }));

        // Pick preferred language or first manual track, or first track
        let track;
        if (preferredLang) {
          track = tracks.find(
            (t) => t.languageCode === preferredLang || t.name?.simpleText === preferredLang
          );
        }
        if (!track) {
          track = tracks.find((t) => t.kind !== "asr") || tracks[0];
        }

        const selectedLang =
          track.name?.simpleText || track.languageCode;
        const entries = await fetchFromCaptionTrack(track);

        return { entries, languages, selectedLang };
      }
    } catch (e) {
      errors.push(`CaptionTrack: ${e.message}`);
    }

    // Method 2: Internal API
    try {
      const entries = await fetchFromInternalAPI(videoId);
      return { entries, languages: [], selectedLang: "" };
    } catch (e) {
      errors.push(`InternalAPI: ${e.message}`);
    }

    // Method 3: DOM scraping
    try {
      const entries = await fetchFromDOM();
      return { entries, languages: [], selectedLang: "" };
    } catch (e) {
      errors.push(`DOM: ${e.message}`);
    }

    throw new Error(
      "No transcript available. Tried all methods:\n" + errors.join("\n")
    );
  }

  /**
   * Fetch transcript for a specific language (using caption tracks)
   */
  async function getTranscriptForLanguage(videoId, lang) {
    const tracks = await getCaptionTracks(videoId);
    const track = tracks.find(
      (t) => t.languageCode === lang || t.name?.simpleText === lang
    );
    if (!track) throw new Error(`Language "${lang}" not available`);
    return await fetchFromCaptionTrack(track);
  }

  return {
    getVideoId,
    getTranscript,
    getTranscriptForLanguage,
    formatTimestamp,
  };
})();
