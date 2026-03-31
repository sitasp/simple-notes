import { useState, useEffect } from "react";
import styles from "./Bookmarks.module.css";

const STORAGE_KEY = "yt_bookmarks";

// Format seconds to MM:SS or H:MM:SS
function formatTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Format date relative (e.g., "2 min ago", "Yesterday")
function formatDate(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function Bookmarks() {
  const [videoId, setVideoId] = useState(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [bookmarks, setBookmarks] = useState([]);
  const [isYoutube, setIsYoutube] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMac, setIsMac] = useState(false);
  const [importStatus, setImportStatus] = useState(null); // null | "success" | "error"

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
    }
    loadCurrentTab();
  }, []);

  // Auto-clear import status after 2 seconds
  useEffect(() => {
    if (importStatus) {
      const timer = setTimeout(() => setImportStatus(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [importStatus]);

  function loadCurrentTab() {
    try {
      // Check if chrome API is available (won't be in localhost dev)
      if (typeof chrome === "undefined" || !chrome.tabs) {
        setLoading(false);
        setIsYoutube(false);
        return;
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0 || !tabs[0].url) {
          setLoading(false);
          setIsYoutube(false);
          return;
        }

        const tab = tabs[0];
        try {
          const url = new URL(tab.url);
          if (url.hostname.includes("youtube.com") && url.pathname === "/watch") {
            const vid = url.searchParams.get("v");
            if (vid) {
              setIsYoutube(true);
              setVideoId(vid);
              setVideoTitle(tab.title?.replace(" - YouTube", "") || "YouTube Video");

              // Load bookmarks using callback pattern
              chrome.storage.local.get(STORAGE_KEY, (data) => {
                if (!chrome.runtime.lastError) {
                  const allBookmarks = data[STORAGE_KEY] || {};
                  const videoData = allBookmarks[vid];
                  if (videoData?.bookmarks) {
                    setBookmarks(videoData.bookmarks);
                    if (videoData.title) setVideoTitle(videoData.title);
                  }
                }
                setLoading(false);
              });
              return;
            }
          }
        } catch (e) {
          console.error("Failed to parse URL:", e);
        }

        // If not youtube, or no vid found
        setLoading(false);
      });
    } catch (e) {
      console.error("Failed to load tab info:", e);
      setLoading(false);
    }
  }

  async function handleDelete(index) {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const allBookmarks = data[STORAGE_KEY] || {};

      if (allBookmarks[videoId]) {
        allBookmarks[videoId].bookmarks.splice(index, 1);

        // Remove video entry if no bookmarks left
        if (allBookmarks[videoId].bookmarks.length === 0) {
          delete allBookmarks[videoId];
        }

        await chrome.storage.local.set({ [STORAGE_KEY]: allBookmarks });
        setBookmarks([...(allBookmarks[videoId]?.bookmarks || [])]);
      }
    } catch (e) {
      console.error("Failed to delete bookmark:", e);
    }
  }

  async function handleClearAll() {
    if (!confirm("Delete all bookmarks for this video?")) return;
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const allBookmarks = data[STORAGE_KEY] || {};
      delete allBookmarks[videoId];
      await chrome.storage.local.set({ [STORAGE_KEY]: allBookmarks });
      setBookmarks([]);
    } catch (e) {
      console.error("Failed to clear bookmarks:", e);
    }
  }

  async function handleSeek(time) {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: "seekTo", time });
      }
    } catch (e) {
      console.error("Failed to seek:", e);
    }
  }

  // ── Export: download all bookmarks as JSON ──
  function handleExport() {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      if (chrome.runtime.lastError) return;
      const json = JSON.stringify(data[STORAGE_KEY] || {}, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "simple-notes-bookmarks.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ── Import: merge JSON file into storage ──
  function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);

        chrome.storage.local.get(STORAGE_KEY, (data) => {
          const existing = data[STORAGE_KEY] || {};
          // Same video IDs → overwrite; new IDs → add as-is
          const merged = { ...existing, ...imported };

          chrome.storage.local.set({ [STORAGE_KEY]: merged }, () => {
            if (!chrome.runtime.lastError) {
              setImportStatus("success");
              // Refresh current video's bookmarks if they were in the import
              if (videoId && merged[videoId]) {
                setBookmarks(merged[videoId].bookmarks || []);
                if (merged[videoId].title) setVideoTitle(merged[videoId].title);
              }
            } else {
              setImportStatus("error");
            }
          });
        });
      } catch (err) {
        console.error("Failed to import bookmarks:", err);
        setImportStatus("error");
      }
    };
    reader.readAsText(file);

    // Reset file input so the same file can be re-imported if needed
    event.target.value = "";
  }

  // ── Shared Export / Import button row ──
  function renderExportImportButtons() {
    return (
      <div className={styles.exportImportRow}>
        <button className={styles.exportBtn} onClick={handleExport} title="Export all bookmarks">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
        <label className={styles.importBtn} title="Import bookmarks from JSON">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import
          <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleImport} />
        </label>
        {importStatus === "success" && <span className={styles.importSuccess}>✓ Imported</span>}
        {importStatus === "error" && <span className={styles.importError}>✕ Failed</span>}
      </div>
    );
  }

  // ── Render states ──
  if (loading) {
    return (
      <div className={styles.notYoutube}>
        <p className={styles.notYoutubeText}>Loading...</p>
      </div>
    );
  }

  if (!isYoutube) {
    return (
      <div className={styles.notYoutube}>
        <div className={styles.notYoutubeIcon}>🎬</div>
        <p className={styles.notYoutubeText}>
          Navigate to a YouTube video to use<br />
          Timestamp Bookmarks
        </p>
        {renderExportImportButtons()}
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>🔖</div>
        <h3 className={styles.emptyTitle}>No bookmarks yet</h3>
        <p className={styles.emptyText}>
          Press <span className={styles.shortcutKey}>{isMac ? "Ctrl+S" : "Alt+S"}</span> while watching
          <br />
          to save a timestamp
        </p>
        <p className={styles.emptyText} style={{ marginTop: "12px" }}>
          <span className={styles.shortcutKey}>{isMac ? "Ctrl+N" : "Alt+N"}</span> next &nbsp;
          <span className={styles.shortcutKey}>{isMac ? "Ctrl+P" : "Alt+P"}</span> previous
        </p>
        {renderExportImportButtons()}
      </div>
    );
  }

  return (
    <div className={styles.bookmarksContainer}>
      <h2 className={styles.videoTitle} title={videoTitle}>
        {videoTitle}
      </h2>

      <div className={styles.headerRow}>
        <p className={styles.bookmarkCount}>
          {bookmarks.length} bookmark{bookmarks.length !== 1 ? "s" : ""}
        </p>
        <button className={styles.clearAllBtn} onClick={handleClearAll}>
          Clear all
        </button>
      </div>

      {bookmarks.map((bookmark, index) => (
        <div
          key={`${bookmark.time}-${bookmark.createdAt}`}
          className={styles.bookmarkItem}
          onClick={() => handleSeek(bookmark.time)}
        >
          <span className={styles.bookmarkIndex}>{index + 1}</span>
          <span className={styles.bookmarkTime}>
            {formatTime(bookmark.time)}
          </span>
          <span className={styles.bookmarkDate}>
            {formatDate(bookmark.createdAt)}
          </span>
          <button
            className={styles.deleteBtn}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(index);
            }}
            title="Delete bookmark"
          >
            ✕
          </button>
        </div>
      ))}

      {renderExportImportButtons()}
    </div>
  );
}
