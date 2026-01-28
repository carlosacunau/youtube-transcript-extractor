/**
 * YouTube Transcript Extractor - Background Service Worker
 * Handles extension icon click and future message routing.
 */

// When the extension icon is clicked, send a message to the content script
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url?.includes("youtube.com/watch")) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggle_panel" });
  } catch {
    // Content script not yet loaded, inject it
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/transcript.js", "src/content/content.js"],
    });
  }
});
