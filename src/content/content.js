/**
 * YouTube Transcript Extractor - Content Script
 * Injects transcript panel into YouTube's sidebar and handles UI interactions.
 */

(() => {
  const CONTAINER_ID = "yt_transcript_extractor_container";
  const SIDEBAR_SELECTOR = "#secondary.style-scope.ytd-watch-flexy";

  let currentVideoId = null;
  let currentTranscriptData = null;

  // --- Theme Detection ---

  function isDarkTheme() {
    const html = document.querySelector("html");
    return html?.getAttribute("dark") !== null;
  }

  function getThemeClass() {
    return isDarkTheme() ? "yte_dark" : "yte_light";
  }

  // --- SVG Icons ---

  const ICONS = {
    copy: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    chevron: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    transcript: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/></svg>`,
    close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };

  // --- HTML Template ---

  function buildPanelHTML() {
    const theme = getThemeClass();
    return `
      <div id="${CONTAINER_ID}" class="yte_container ${theme}">
        <div class="yte_close_btn" id="yte_close_btn" title="Close">${ICONS.close}</div>
        <div class="yte_header" id="yte_header">
          <div class="yte_header_left">
            <span class="yte_icon">${ICONS.transcript}</span>
            <span class="yte_header_text">Transcript</span>
          </div>
          <div class="yte_header_actions">
            <button class="yte_action_btn" id="yte_copy_btn" title="Copy transcript">
              ${ICONS.copy} <span>Copy</span>
            </button>
            <button class="yte_action_btn" id="yte_download_btn" title="Download transcript">
              ${ICONS.download} <span>Download</span>
            </button>
            <button class="yte_toggle_btn" id="yte_toggle_btn" title="Toggle transcript">
              ${ICONS.chevron}
            </button>
          </div>
        </div>
        <div class="yte_lang_select" id="yte_lang_select"></div>
        <div class="yte_body" id="yte_body">
          <div class="yte_loading" id="yte_loading">
            <div class="yte_spinner"></div>
            <span>Loading transcript...</span>
          </div>
          <div class="yte_error" id="yte_error" style="display:none;">
            <p id="yte_error_msg">No transcript available</p>
          </div>
          <div class="yte_transcript_list" id="yte_transcript_list"></div>
        </div>
      </div>
    `;
  }

  // --- Panel Injection ---

  function removeExistingPanel() {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
  }

  function injectPanel() {
    removeExistingPanel();

    const sidebar = document.querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) return false;

    sidebar.insertAdjacentHTML("afterbegin", buildPanelHTML());
    attachEventListeners();
    return true;
  }

  // --- Event Listeners ---

  function attachEventListeners() {
    // Toggle body visibility
    const toggleBtn = document.getElementById("yte_toggle_btn");
    const header = document.getElementById("yte_header");
    const body = document.getElementById("yte_body");
    const langSelect = document.getElementById("yte_lang_select");

    const togglePanel = () => {
      const isHidden = body.style.display === "none";
      body.style.display = isHidden ? "block" : "none";
      if (langSelect) langSelect.style.display = isHidden ? "flex" : "none";
      toggleBtn.classList.toggle("yte_rotated", !isHidden);
    };

    toggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    header?.addEventListener("click", togglePanel);

    // Close button
    document.getElementById("yte_close_btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removeExistingPanel();
    });

    // Copy button
    document.getElementById("yte_copy_btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      copyTranscript();
    });

    // Download button
    document.getElementById("yte_download_btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadTranscript();
    });
  }

  // --- Transcript Rendering ---

  function renderTranscript(entries) {
    const list = document.getElementById("yte_transcript_list");
    if (!list) return;

    list.innerHTML = entries
      .map(
        (entry) => `
        <div class="yte_segment" data-start="${entry.start}">
          <span class="yte_timestamp" data-start="${entry.start}">
            ${TranscriptExtractor.formatTimestamp(entry.start)}
          </span>
          <span class="yte_text">${escapeHTML(entry.text)}</span>
        </div>
      `
      )
      .join("");

    // Timestamp click handlers
    list.querySelectorAll(".yte_timestamp").forEach((el) => {
      el.addEventListener("click", () => {
        const seconds = parseInt(el.getAttribute("data-start"), 10);
        seekVideo(seconds);
      });
    });
  }

  function renderLanguageButtons(languages, selectedLang) {
    const container = document.getElementById("yte_lang_select");
    if (!container || !languages || languages.length <= 1) {
      if (container) container.style.display = "none";
      return;
    }

    container.style.display = "flex";
    container.innerHTML = languages
      .map((lang) => {
        const isSelected = lang.name === selectedLang || lang.code === selectedLang;
        const label = lang.isAuto ? `${lang.name} (auto)` : lang.name;
        return `
          <button class="yte_lang_btn ${isSelected ? "yte_lang_selected" : ""}"
                  data-lang-code="${lang.code}"
                  data-lang-name="${lang.name}">
            ${escapeHTML(label)}
          </button>
        `;
      })
      .join("");

    // Language switch handlers
    container.querySelectorAll(".yte_lang_btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const langCode = btn.getAttribute("data-lang-code");
        const langName = btn.getAttribute("data-lang-name");

        // Update selected state
        container.querySelectorAll(".yte_lang_btn").forEach((b) =>
          b.classList.remove("yte_lang_selected")
        );
        btn.classList.add("yte_lang_selected");

        // Fetch transcript for the selected language
        showLoading();
        try {
          const entries = await TranscriptExtractor.getTranscriptForLanguage(
            currentVideoId,
            langCode
          );
          currentTranscriptData = entries;
          showTranscript();
          renderTranscript(entries);
        } catch (err) {
          showError(`Could not load ${langName} transcript.`);
        }
      });
    });
  }

  function showLoading() {
    const loading = document.getElementById("yte_loading");
    const error = document.getElementById("yte_error");
    const list = document.getElementById("yte_transcript_list");
    if (loading) loading.style.display = "flex";
    if (error) error.style.display = "none";
    if (list) list.innerHTML = "";
  }

  function showError(message) {
    const loading = document.getElementById("yte_loading");
    const error = document.getElementById("yte_error");
    const errorMsg = document.getElementById("yte_error_msg");
    if (loading) loading.style.display = "none";
    if (error) error.style.display = "block";
    if (errorMsg) errorMsg.textContent = message;
  }

  function showTranscript() {
    const loading = document.getElementById("yte_loading");
    const error = document.getElementById("yte_error");
    if (loading) loading.style.display = "none";
    if (error) error.style.display = "none";
  }

  // --- Actions ---

  function copyTranscript() {
    if (!currentTranscriptData || currentTranscriptData.length === 0) return;

    const text = currentTranscriptData
      .map(
        (entry) =>
          `${TranscriptExtractor.formatTimestamp(entry.start)} - ${entry.text}`
      )
      .join("\n");

    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("yte_copy_btn");
      if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = `${ICONS.copy} <span>Copied!</span>`;
        setTimeout(() => {
          btn.innerHTML = original;
        }, 2000);
      }
    });
  }

  function downloadTranscript() {
    if (!currentTranscriptData || currentTranscriptData.length === 0) return;

    const text = currentTranscriptData
      .map(
        (entry) =>
          `${TranscriptExtractor.formatTimestamp(entry.start)} - ${entry.text}`
      )
      .join("\n");

    const title = document.title.replace(" - YouTube", "").trim();
    const safeName = title.replace(/[^a-z0-9\s\-_]/gi, "").substring(0, 100);
    const filename = `${safeName}_transcript.txt`;

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Visual feedback
    const btn = document.getElementById("yte_download_btn");
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = `${ICONS.download} <span>Downloaded!</span>`;
      setTimeout(() => {
        btn.innerHTML = original;
      }, 2000);
    }
  }

  function seekVideo(seconds) {
    const video = document.querySelector("video");
    if (video) {
      video.currentTime = seconds;
      video.play();
    }

    // Highlight the active segment
    document.querySelectorAll(".yte_segment").forEach((seg) => {
      seg.classList.remove("yte_segment_active");
      if (parseInt(seg.getAttribute("data-start"), 10) === seconds) {
        seg.classList.add("yte_segment_active");
      }
    });
  }

  // --- Utility ---

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Main Logic ---

  async function loadTranscript(videoId) {
    currentVideoId = videoId;
    currentTranscriptData = null;

    // Wait for sidebar to be available
    const sidebar = await waitForElement(SIDEBAR_SELECTOR, 10000);
    if (!sidebar) return;

    const injected = injectPanel();
    if (!injected) return;

    // Show body by default
    const body = document.getElementById("yte_body");
    if (body) body.style.display = "block";

    try {
      const { entries, languages, selectedLang } =
        await TranscriptExtractor.getTranscript(videoId);

      currentTranscriptData = entries;
      showTranscript();
      renderTranscript(entries);
      renderLanguageButtons(languages, selectedLang);
    } catch (err) {
      showError(
        "No transcript available for this video. The video may not have captions enabled."
      );
    }
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // --- SPA Navigation Handling ---

  function onVideoChange() {
    const videoId = TranscriptExtractor.getVideoId();
    if (!videoId || videoId === currentVideoId) return;
    loadTranscript(videoId);
  }

  function startNavigationWatcher() {
    let lastUrl = location.href;

    // Watch for URL changes (YouTube SPA navigation)
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Small delay to let YouTube update the page
        setTimeout(onVideoChange, 1500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also listen for popstate (back/forward navigation)
    window.addEventListener("popstate", () => {
      setTimeout(onVideoChange, 1500);
    });
  }

  // --- Theme Change Observer ---

  function watchThemeChanges() {
    const html = document.querySelector("html");
    if (!html) return;

    const observer = new MutationObserver(() => {
      const container = document.getElementById(CONTAINER_ID);
      if (!container) return;

      container.classList.remove("yte_dark", "yte_light");
      container.classList.add(getThemeClass());
    });

    observer.observe(html, { attributes: true, attributeFilter: ["dark"] });
  }

  // --- Initialize ---

  function init() {
    // Only run on YouTube watch pages
    if (!location.hostname.includes("youtube.com")) return;

    startNavigationWatcher();
    watchThemeChanges();

    // Initial load if on a video page
    const videoId = TranscriptExtractor.getVideoId();
    if (videoId) {
      // Delay initial load to let YouTube page render
      setTimeout(() => loadTranscript(videoId), 2000);
    }
  }

  init();
})();
