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

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
    }
    loadCurrentTab();
  }, []);

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
                setLoading(false); // ALWAYS update loading state after completion
              });
              return; // return so we don't hit the bottom setLoading(false) instantly
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
          Navigate to a YouTube video to use
          <br />
          Timestamp Bookmarks
        </p>
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
    </div>
  );
}
