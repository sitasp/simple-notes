// Simple Notes - YouTube Content Script
// Runs on YouTube pages to interact with the video player
// Includes sticky-note overlay for timestamp notes

(() => {
  // ─── Swoosh sound via Web Audio API (no external file needed) ───────────
  function playSwoosh() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const duration = 0.25;
      const sampleRate = ctx.sampleRate;
      const length = Math.floor(sampleRate * duration);
      const buffer = ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      // Generate a subtle swoosh: filtered noise with volume envelope
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const noise = Math.random() * 2 - 1;
        const envelope =
          Math.exp(-t * 16) * Math.sin((t * Math.PI) / duration);
        const sweep = Math.sin(2 * Math.PI * (800 + t * 3000) * t);
        data[i] = (noise * 0.3 + sweep * 0.7) * envelope * 0.12;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2000, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(
        500,
        ctx.currentTime + duration
      );

      source.connect(filter);
      filter.connect(ctx.destination);
      source.start();
      source.onended = () => ctx.close();
    } catch (e) {
      // Sound is a nice-to-have, don't break on failure
    }
  }

  // ─── Video element helper ───────────────────────────────────────────────
  function getVideoElement() {
    return document.querySelector("video");
  }


  // ─── Format seconds to MM:SS or H:MM:SS ────────────────────────────────
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

  // ─── Sticky Note Overlay ───────────────────────────────────────────────
  let noteOverlay = null;
  let currentVideoId = null;
  let currentBookmarkTime = null;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function createNoteOverlay() {
    // Remove existing overlay
    if (noteOverlay) {
      noteOverlay.remove();
      noteOverlay = null;
    }

    const overlay = document.createElement("div");
    overlay.id = "sn-note-overlay";
    overlay.innerHTML = `
      <style>
        #sn-note-overlay {
          position: fixed;
          right: 24px;
          bottom: 28%;
          width: 360px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          animation: sn-slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes sn-slideIn {
          from { opacity: 0; transform: translateX(20px) scale(0.95); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes sn-slideOut {
          from { opacity: 1; transform: translateX(0) scale(1); }
          to   { opacity: 0; transform: translateX(20px) scale(0.95); }
        }

        #sn-note-overlay .sn-window {
          background: rgba(30, 30, 35, 0.95);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.5),
            0 0 0 1px rgba(255, 255, 255, 0.05) inset;
          overflow: hidden;
          transition: box-shadow 0.3s ease;
        }

        #sn-note-overlay .sn-window.sn-glow-active {
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.5),
            inset 0 0 24px rgba(116, 56, 216, 0.4),
            0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        }

        /* ── Title bar ── */
        #sn-note-overlay .sn-titlebar {
          display: flex;
          align-items: center;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.04);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          cursor: grab;
          user-select: none;
        }
        #sn-note-overlay .sn-titlebar:active { cursor: grabbing; }

        #sn-note-overlay .sn-traffic-lights {
          display: flex;
          gap: 7px;
          margin-right: 12px;
        }
        #sn-note-overlay .sn-dot {
          width: 12px; height: 12px;
          border-radius: 50%;
          cursor: pointer;
          transition: filter 0.15s;
        }
        #sn-note-overlay .sn-dot:hover { filter: brightness(1.3); }
        #sn-note-overlay .sn-dot-close { background: #ff5f57; }
        #sn-note-overlay .sn-dot-min   { background: #febc2e; }
        #sn-note-overlay .sn-dot-max   { background: #28c840; }

        #sn-note-overlay .sn-title-text {
          flex: 1;
          font-size: 12px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.5);
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        #sn-note-overlay .sn-tabs {
          display: flex;
          gap: 2px;
          margin-left: 12px;
        }
        #sn-note-overlay .sn-tab {
          padding: 3px 10px;
          font-size: 11px;
          font-weight: 500;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 4px;
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          transition: all 0.15s;
        }
        #sn-note-overlay .sn-tab:hover {
          background: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.8);
        }
        #sn-note-overlay .sn-tab.sn-active {
          background: rgba(116, 56, 216, 0.3);
          border-color: rgba(116, 56, 216, 0.5);
          color: #c9a5ff;
        }

        /* ── Body ── */
        #sn-note-overlay .sn-body {
          padding: 14px;
          min-height: 200px;
          max-height: 280px;
        }

        #sn-note-overlay .sn-textarea {
          width: 100%;
          min-height: 200px;
          max-height: 260px;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #e0e0e0;
          font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
          padding: 10px 12px;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
        }
        #sn-note-overlay .sn-textarea:focus {
          border-color: rgba(116, 56, 216, 0.5);
        }
        #sn-note-overlay .sn-textarea::placeholder {
          color: rgba(255, 255, 255, 0.25);
        }

        #sn-note-overlay .sn-preview {
          color: #e0e0e0;
          font-size: 13px;
          line-height: 1.7;
          padding: 4px 0;
          min-height: 200px;
          max-height: 260px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.2) transparent;
        }
        #sn-note-overlay .sn-preview h1 { font-size: 18px; margin: 0 0 8px; color: #fff; }
        #sn-note-overlay .sn-preview h2 { font-size: 16px; margin: 0 0 6px; color: #fff; }
        #sn-note-overlay .sn-preview h3 { font-size: 14px; margin: 0 0 4px; color: #fff; }
        #sn-note-overlay .sn-preview strong { color: #FFD700; }
        #sn-note-overlay .sn-preview em { color: #c9a5ff; }
        #sn-note-overlay .sn-preview code {
          background: rgba(255,255,255,0.08);
          padding: 1px 5px;
          border-radius: 3px;
          font-family: 'Menlo', monospace;
          font-size: 12px;
        }
        #sn-note-overlay .sn-preview ul,
        #sn-note-overlay .sn-preview ol {
          margin: 4px 0;
          padding-left: 24px;
        }
        #sn-note-overlay .sn-preview ul {
          list-style-type: disc;
        }
        #sn-note-overlay .sn-preview ol {
          list-style-type: decimal;
        }
        #sn-note-overlay .sn-preview li {
          margin-bottom: 2px;
        }
        #sn-note-overlay .sn-preview .sn-empty-note {
          color: rgba(255,255,255,0.3);
          font-style: italic;
        }

        /* ── Footer ── */
        #sn-note-overlay .sn-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.02);
        }
        #sn-note-overlay .sn-shortcut-hint {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.3);
        }
        #sn-note-overlay .sn-shortcut-hint kbd {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 3px;
          padding: 0 4px;
          font-family: 'Menlo', monospace;
          font-size: 10px;
        }
        #sn-note-overlay .sn-save-btn {
          padding: 5px 16px;
          font-size: 12px;
          font-weight: 600;
          background: linear-gradient(135deg, #7438D8, #9b59b6);
          border: none;
          border-radius: 6px;
          color: white;
          cursor: pointer;
          transition: all 0.2s;
        }
        #sn-note-overlay .sn-save-btn:hover {
          background: linear-gradient(135deg, #8548E8, #ab69c6);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(116, 56, 216, 0.4);
        }
        #sn-note-overlay .sn-save-btn:active {
          transform: translateY(0);
        }
      </style>

      <div class="sn-window">
        <div class="sn-titlebar" id="sn-titlebar">
          <div class="sn-traffic-lights">
            <div class="sn-dot sn-dot-close" id="sn-close" title="Close (Esc)"></div>
            <div class="sn-dot sn-dot-min"></div>
            <div class="sn-dot sn-dot-max"></div>
          </div>
          <span class="sn-title-text" id="sn-title-text">Note</span>
          <div class="sn-tabs">
            <button class="sn-tab sn-active" id="sn-tab-edit">Edit</button>
            <button class="sn-tab" id="sn-tab-preview">Preview</button>
          </div>
        </div>
        <div class="sn-body">
          <textarea
            class="sn-textarea"
            id="sn-textarea"
            placeholder="Write your note in markdown...&#10;&#10;# Heading&#10;**bold** *italic* \`code\`&#10;- list item"
            spellcheck="false"
          ></textarea>
          <div class="sn-preview" id="sn-preview" style="display:none;"></div>
        </div>
        <div class="sn-footer" id="sn-footer">
          <span class="sn-shortcut-hint">
            <kbd>⌘/Ctrl+S</kbd> save &nbsp; <kbd>⌘/Ctrl+E</kbd> toggle &nbsp; <kbd>Esc</kbd> close
          </span>
          <button class="sn-save-btn" id="sn-save-btn">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    noteOverlay = overlay;

    // ── Wire up events ──
    const closeBtn = overlay.querySelector("#sn-close");
    const tabEdit = overlay.querySelector("#sn-tab-edit");
    const tabPreview = overlay.querySelector("#sn-tab-preview");
    const textarea = overlay.querySelector("#sn-textarea");
    const preview = overlay.querySelector("#sn-preview");
    const saveBtn = overlay.querySelector("#sn-save-btn");
    const titlebar = overlay.querySelector("#sn-titlebar");
    const footer = overlay.querySelector("#sn-footer");

    // Close
    closeBtn.addEventListener("click", () => hideNoteOverlay());

    // Tabs
    tabEdit.addEventListener("click", () => switchToEdit());
    tabPreview.addEventListener("click", () => switchToPreview());

    // Save
    saveBtn.addEventListener("click", () => saveCurrentNote());

    // Keyboard shortcuts inside the overlay
    overlay.addEventListener("keydown", (e) => {
      // Ctrl/Cmd+S — Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopPropagation();
        saveCurrentNote();
        return;
      }
      // Ctrl/Cmd+E — Toggle Edit/Preview
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        e.stopPropagation();
        if (textarea.style.display !== "none") {
          switchToPreview();
        } else {
          switchToEdit();
        }
        return;
      }
      // Escape — Close
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        hideNoteOverlay();
        return;
      }
    });

    // Dragging
    titlebar.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("sn-dot") || e.target.classList.contains("sn-tab")) return;
      isDragging = true;
      const rect = overlay.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging || !noteOverlay) return;
      noteOverlay.style.right = "auto";
      noteOverlay.style.bottom = "auto";
      noteOverlay.style.left = (e.clientX - dragOffsetX) + "px";
      noteOverlay.style.top = (e.clientY - dragOffsetY) + "px";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });

    // Helper functions
    function switchToEdit() {
      textarea.style.display = "";
      preview.style.display = "none";
      tabEdit.classList.add("sn-active");
      tabPreview.classList.remove("sn-active");
      footer.style.display = "";
      overlay.querySelector(".sn-window").classList.remove("sn-glow-active");
      textarea.focus();
    }

    function switchToPreview() {
      const md = textarea.value;
      
      let htmlContent = '<span class="sn-empty-note">No note content yet</span>';
      if (md.trim()) {
        try {
          // marked.parse handles linebreaks properly if we set breaks: true
          htmlContent = typeof marked !== "undefined" ? marked.parse(md, { breaks: true }) : md;
        } catch(e) {
          htmlContent = md;
        }
      }
      
      preview.innerHTML = htmlContent;
      textarea.style.display = "none";
      preview.style.display = "";
      tabPreview.classList.add("sn-active");
      tabEdit.classList.remove("sn-active");

      const windowEl = overlay.querySelector(".sn-window");
      if (preview.scrollHeight > preview.clientHeight) {
        windowEl.classList.add("sn-glow-active");
      } else {
        windowEl.classList.remove("sn-glow-active");
      }
    }

    function saveCurrentNote() {
      const noteText = textarea.value;
      chrome.runtime.sendMessage(
        {
          action: "saveNote",
          videoId: currentVideoId,
          bookmarkTime: currentBookmarkTime,
          noteText,
        },
        (response) => {
          if (response?.success) {
            // Brief green flash on the save button
            saveBtn.textContent = "✓ Saved";
            saveBtn.style.background = "linear-gradient(135deg, #28c840, #22a835)";
            setTimeout(() => {
              hideNoteOverlay();
            }, 600);
          }
        }
      );
    }

    return overlay;
  }

  function showNoteEditor(videoId, bookmark) {
    currentVideoId = videoId;
    currentBookmarkTime = bookmark.time;

    const overlay = createNoteOverlay();
    const textarea = overlay.querySelector("#sn-textarea");
    const titleText = overlay.querySelector("#sn-title-text");
    const footer = overlay.querySelector("#sn-footer");

    // Set title
    titleText.textContent = `📝 Note @ ${formatTime(bookmark.time)}`;

    // Pre-fill existing note
    if (bookmark.note) {
      textarea.value = bookmark.note;
    }

    // Show in edit mode with footer visible
    textarea.style.display = "";
    overlay.querySelector("#sn-preview").style.display = "none";
    footer.style.display = "";

    textarea.focus();
  }

  function showNotePreview(videoId, bookmark) {
    currentVideoId = videoId;
    currentBookmarkTime = bookmark.time;

    const overlay = createNoteOverlay();
    const textarea = overlay.querySelector("#sn-textarea");
    const preview = overlay.querySelector("#sn-preview");
    const titleText = overlay.querySelector("#sn-title-text");
    const tabEdit = overlay.querySelector("#sn-tab-edit");
    const tabPreview = overlay.querySelector("#sn-tab-preview");
    const footer = overlay.querySelector("#sn-footer");

    // Set title
    titleText.textContent = `📝 Note @ ${formatTime(bookmark.time)}`;

    // Fill text + render preview
    textarea.value = bookmark.note || "";
    
    let htmlContent = '<span class="sn-empty-note">No note content</span>';
    if (bookmark.note && bookmark.note.trim()) {
      try {
        htmlContent = typeof marked !== "undefined" ? marked.parse(bookmark.note, { breaks: true }) : bookmark.note;
      } catch(e) {
        htmlContent = bookmark.note;
      }
    }
    preview.innerHTML = htmlContent;

    // Show in preview mode
    textarea.style.display = "none";
    preview.style.display = "";
    tabPreview.classList.add("sn-active");
    tabEdit.classList.remove("sn-active");

    const windowEl = overlay.querySelector(".sn-window");
    if (preview.scrollHeight > preview.clientHeight) {
      windowEl.classList.add("sn-glow-active");
    } else {
      windowEl.classList.remove("sn-glow-active");
    }

    // Show footer so user can switch to edit if desired
    footer.style.display = "";
  }

  function hideNoteOverlay() {
    if (noteOverlay) {
      noteOverlay.style.animation = "sn-slideOut 0.2s ease forwards";
      setTimeout(() => {
        if (noteOverlay) {
          noteOverlay.remove();
          noteOverlay = null;
        }
      }, 200);
    }
  }

  // ─── Message listener ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const video = getVideoElement();

    switch (message.action) {
      case "getCurrentTime":
        if (video) {
          sendResponse({ time: video.currentTime, duration: video.duration });
        } else {
          sendResponse({ error: "No video element found" });
        }
        break;

      case "seekTo":
        if (video && typeof message.time === "number") {
          video.currentTime = message.time;
          sendResponse({ success: true });
        } else {
          sendResponse({ error: "Cannot seek" });
        }
        break;

      case "playSwoosh":
        playSwoosh();
        sendResponse({ success: true });
        break;

      case "showNoteEditor":
        showNoteEditor(message.videoId, message.bookmark);
        sendResponse({ success: true });
        break;

      case "showNotePreview":
        showNotePreview(message.videoId, message.bookmark);
        sendResponse({ success: true });
        break;

      case "hideNote":
        hideNoteOverlay();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: "Unknown action" });
    }

    return true; // Keep the message channel open for async responses
  });

  console.log("[Simple Notes] YouTube Timestamp Bookmarks content script loaded");
})();
