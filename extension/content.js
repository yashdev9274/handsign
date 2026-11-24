const isHandsignPage =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1";

const isMeetingPage =
  location.hostname === "meet.google.com" ||
  location.hostname.endsWith(".zoom.us");

/*
 * This part runs on the local Handsign page.
 * It forwards gesture events to the extension background worker.
 */
if (isHandsignPage) {
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.data?.source !== "handsign-app"
    ) {
      return;
    }

    if (event.data.type === "HANDSIGN_GESTURES_UPDATED") {
      chrome.runtime.sendMessage({
        type: "SYNC_GESTURES",
        gestures: event.data.gestures || []
      });
    }

    if (event.data.type === "HANDSIGN_GESTURE_DETECTED") {
      chrome.runtime.sendMessage({
        type: "GESTURE_DETECTED",
        gesture: event.data.gesture,
        durationMs: event.data.durationMs || 3500
      });
    }
  });
}

/*
 * This part runs on Google Meet and Zoom pages.
 * It receives the vanish event and hides the largest visible video tile.
 */
if (isMeetingPage) {
  let hiddenTile = null;
  let restoreTimer = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "VANISH_PARTICIPANT") {
      vanishBestTile(message.durationMs || 3500);
    }
  });

  function vanishBestTile(durationMs) {
    restoreTile();

    const videos = [...document.querySelectorAll("video")]
      .filter((video) => {
        const rect = video.getBoundingClientRect();

        return (
          rect.width >= 120 &&
          rect.height >= 90 &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .sort((first, second) => tileArea(second) - tileArea(first));

    const video = videos[0];

    if (!video) {
      console.warn("Handsign: no visible meeting video tile found.");
      return;
    }

    const tile =
      video.closest(
        "[data-participant-id], [data-self-name], [role='listitem']"
      ) || video.parentElement;

    if (!tile) {
      console.warn("Handsign: could not find the meeting tile container.");
      return;
    }

    hiddenTile = {
      element: tile,
      visibility: tile.style.visibility,
      opacity: tile.style.opacity,
      filter: tile.style.filter,
      outline: tile.style.outline
    };

    tile.style.visibility = "hidden";
    tile.style.opacity = "0";
    tile.style.filter = "blur(18px)";
    tile.style.outline = "2px solid #9b8cff";

    restoreTimer = window.setTimeout(() => {
      restoreTile();
    }, durationMs);
  }

  function restoreTile() {
    if (!hiddenTile) return;

    const {
      element,
      visibility,
      opacity,
      filter,
      outline
    } = hiddenTile;

    element.style.visibility = visibility;
    element.style.opacity = opacity;
    element.style.filter = filter;
    element.style.outline = outline;

    hiddenTile = null;

    if (restoreTimer) {
      window.clearTimeout(restoreTimer);
    }

    restoreTimer = null;
  }

  function tileArea(video) {
    const rect = video.getBoundingClientRect();

    return rect.width * rect.height;
  }
}