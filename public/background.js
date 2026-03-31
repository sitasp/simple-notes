// Simple Notes - Background Service Worker
// Handles keyboard shortcuts, storage, and badge management for YouTube Timestamp Bookmarks

const STORAGE_KEY = "yt_bookmarks";

// ─── Icon flash animation ───────────────────────────────────────────────────
async function flashIcon(tabId) {
  const frames = 6; // 3 cycles of bright→normal
  const delay = 100; // ms per frame

  for (let i = 0; i < frames; i++) {
    if (i % 2 === 0) {
      // Bright flash — use a colored badge as the "glow"
      await chrome.action.setBadgeBackgroundColor({ color: "#FFD700", tabId });
      await chrome.action.setBadgeText({ text: "✦", tabId });
    } else {
      await chrome.action.setBadgeText({ text: "", tabId });
    }
    await new Promise((r) => setTimeout(r, delay));
  }

  // After flash, update badge to show actual bookmark count
  await updateBadgeForTab(tabId);
}

// ─── Badge management ───────────────────────────────────────────────────────
function getVideoIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.pathname === "/watch") {
      return u.searchParams.get("v");
    }
  } catch (e) {}
  return null;
}

async function updateBadgeForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const videoId = getVideoIdFromUrl(tab.url || "");

    if (!videoId) {
      await chrome.action.setBadgeText({ text: "", tabId });
      await chrome.action.setIcon({
        path: {
          16: "icons/icon16.png",
          32: "icons/icon32.png",
          48: "icons/icon48.png",
        },
        tabId,
      });
      return;
    }

    const data = await chrome.storage.local.get(STORAGE_KEY);
    const allBookmarks = data[STORAGE_KEY] || {};
    const videoData = allBookmarks[videoId];
    const count = videoData?.bookmarks?.length || 0;

    if (count > 0) {
      await chrome.action.setBadgeText({ text: String(count), tabId });
      await chrome.action.setBadgeBackgroundColor({
        color: "#7438D8",
        tabId,
      });
      // Use the active/glowing icon
      await chrome.action.setIcon({
        path: {
          16: "icons/icon16-active.png",
          32: "icons/icon32-active.png",
          48: "icons/icon48-active.png",
        },
        tabId,
      });
    } else {
      await chrome.action.setBadgeText({ text: "", tabId });
      await chrome.action.setIcon({
        path: {
          16: "icons/icon16.png",
          32: "icons/icon32.png",
          48: "icons/icon48.png",
        },
        tabId,
      });
    }
  } catch (e) {
    // Tab may have been closed
  }
}

// ─── Helper: save or reuse a bookmark at current time ───────────────────────
async function saveOrReuseBookmark(videoId, tab, currentTime) {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const allBookmarks = data[STORAGE_KEY] || {};

  if (!allBookmarks[videoId]) {
    allBookmarks[videoId] = {
      title: tab.title?.replace(" - YouTube", "") || "Unknown Video",
      bookmarks: [],
    };
  }

  // Check if bookmark already exists within 1 second
  const existingIndex = allBookmarks[videoId].bookmarks.findIndex(
    (b) => Math.abs(b.time - currentTime) < 1
  );

  let bookmark;
  let isNew = false;

  if (existingIndex >= 0) {
    bookmark = allBookmarks[videoId].bookmarks[existingIndex];
  } else {
    bookmark = {
      time: currentTime,
      createdAt: Date.now(),
    };
    allBookmarks[videoId].bookmarks.push(bookmark);
    allBookmarks[videoId].bookmarks.sort((a, b) => a.time - b.time);
    isNew = true;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: allBookmarks });
  return { bookmark, isNew };
}

// ─── Keyboard shortcut handlers ─────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  console.log(`[Simple Notes] Command received: ${command}`);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    console.log("[Simple Notes] No active tab found.");
    return;
  }

  const videoId = getVideoIdFromUrl(tab.url || "");
  console.log(`[Simple Notes] Found video ID: ${videoId} for url: ${tab.url}`);
  if (!videoId) return; // Not on a YouTube video page

  if (command === "save-timestamp") {
    // Ask content script for the current video time
    try {
      console.log(`[Simple Notes] Sending getCurrentTime to tab ${tab.id}`);
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "getCurrentTime",
      });
      console.log(`[Simple Notes] Response from content script:`, response);

      if (response?.time !== undefined) {
        await saveOrReuseBookmark(videoId, tab, response.time);

        // Play swoosh sound via content script
        await chrome.tabs.sendMessage(tab.id, { action: "playSwoosh" });

        // Flash the icon
        await flashIcon(tab.id);
      }
    } catch (e) {
      console.error("Failed to save timestamp:", e);
    }
  } else if (command === "save-timestamp-with-note") {
    // Save timestamp + open note editor
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "getCurrentTime",
      });

      if (response?.time !== undefined) {
        const { bookmark } = await saveOrReuseBookmark(videoId, tab, response.time);

        // Play swoosh sound
        await chrome.tabs.sendMessage(tab.id, { action: "playSwoosh" });

        // Flash the icon
        await flashIcon(tab.id);

        // Tell content script to open the note editor
        await chrome.tabs.sendMessage(tab.id, {
          action: "showNoteEditor",
          videoId,
          bookmark,
        });
      }
    } catch (e) {
      console.error("Failed to save timestamp with note:", e);
    }
  } else if (command === "next-timestamp" || command === "prev-timestamp") {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "getCurrentTime",
      });

      if (response?.time !== undefined) {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        const allBookmarks = data[STORAGE_KEY] || {};
        const bookmarks = allBookmarks[videoId]?.bookmarks || [];

        if (bookmarks.length === 0) return;

        let targetBookmark;
        const currentTime = response.time;

        if (command === "next-timestamp") {
          // Find the first bookmark after current time (with 1s tolerance)
          const next = bookmarks.find((b) => b.time > currentTime + 1);
          targetBookmark = next || bookmarks[0]; // Wrap around
        } else {
          // Find the last bookmark before current time (with 1s tolerance)
          const prevList = bookmarks.filter((b) => b.time < currentTime - 1);
          targetBookmark =
            prevList.length > 0
              ? prevList[prevList.length - 1]
              : bookmarks[bookmarks.length - 1]; // Wrap around
        }

        await chrome.tabs.sendMessage(tab.id, {
          action: "seekTo",
          time: targetBookmark.time,
        });

        // If the target bookmark has a note, show it as a preview
        if (targetBookmark.note) {
          await chrome.tabs.sendMessage(tab.id, {
            action: "showNotePreview",
            videoId,
            bookmark: targetBookmark,
          });
        } else {
          // Hide any existing note overlay if navigating to a bookmark without a note
          await chrome.tabs.sendMessage(tab.id, {
            action: "hideNote",
          });
        }
      }
    } catch (e) {
      console.error("Failed to navigate timestamp:", e);
    }
  }
});

// ─── Message listener for saving notes from content script ──────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "saveNote") {
    const { videoId, bookmarkTime, noteText } = message;

    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const allBookmarks = data[STORAGE_KEY] || {};
      const videoData = allBookmarks[videoId];

      if (videoData) {
        const bookmark = videoData.bookmarks.find(
          (b) => Math.abs(b.time - bookmarkTime) < 0.01
        );

        if (bookmark) {
          if (noteText && noteText.trim()) {
            bookmark.note = noteText;
          } else {
            delete bookmark.note; // Remove empty notes
          }

          chrome.storage.local.set({ [STORAGE_KEY]: allBookmarks }, () => {
            sendResponse({ success: true });
          });
          return; // Keep channel open
        }
      }

      sendResponse({ error: "Bookmark not found" });
    });

    return true; // Keep message channel open for async response
  }
});

// ─── Tab change listeners for badge updates ─────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateBadgeForTab(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateBadgeForTab(tabId);
});

// Update badge when bookmarks change
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes[STORAGE_KEY]) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      updateBadgeForTab(tab.id);
    }
  }
});
