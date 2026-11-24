const MEETING_PATTERNS = [
    "https://meet.google.com/*",
    "https://*.zoom.us/*"
  ];
  
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SYNC_GESTURES") {
      chrome.storage.local.set({
        gestures: message.gestures || []
      });
  
      return;
    }
  
    if (message.type === "GESTURE_DETECTED") {
      chrome.tabs.query(
        {
          url: MEETING_PATTERNS
        },
        (tabs) => {
          for (const tab of tabs) {
            if (!tab.id) continue;
  
            chrome.tabs.sendMessage(tab.id, {
              type: "VANISH_PARTICIPANT",
              gesture: message.gesture,
              durationMs: message.durationMs || 3500
            });
          }
        }
      );
    }
  });