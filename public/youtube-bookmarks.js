// Simple Notes - YouTube Content Script
// Runs on YouTube pages to interact with the video player

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
        // Noise source
        const noise = (Math.random() * 2 - 1);
        // Envelope: quick attack, smooth decay
        const envelope = Math.exp(-t * 16) * Math.sin(t * Math.PI / duration);
        // Frequency sweep for the "swoosh" character
        const sweep = Math.sin(2 * Math.PI * (800 + t * 3000) * t);
        data[i] = (noise * 0.3 + sweep * 0.7) * envelope * 0.12;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // Low-pass filter for smoothness
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2000, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + duration);

      source.connect(filter);
      filter.connect(ctx.destination);
      source.start();

      // Clean up context after sound completes
      source.onended = () => ctx.close();
    } catch (e) {
      // Sound is a nice-to-have, don't break on failure
    }
  }

  // ─── Video element helper ───────────────────────────────────────────────
  function getVideoElement() {
    return document.querySelector("video");
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

      default:
        sendResponse({ error: "Unknown action" });
    }

    return true; // Keep the message channel open for async responses
  });

  console.log("[Simple Notes] YouTube Timestamp Bookmarks content script loaded");
})();
