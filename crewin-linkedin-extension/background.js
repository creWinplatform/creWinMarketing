// CrewinJob web uygulamasından gelen mesajları dinler
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'postToLinkedIn') {
    sendResponse({ success: false, error: 'Bilinmeyen aksiyon' });
    return false;
  }

  const { text, imageData, imageMime, orgId } = message;

  // 1. Veriyi storage'a kaydet (content script okuyacak)
  chrome.storage.local.set({
    pendingPost: {
      text:      text || '',
      imageData: imageData || null,
      imageMime: imageMime || 'image/jpeg',
      timestamp: Date.now(),
    },
  }, () => {
    // 2. LinkedIn feed share modal'ını doğrudan aç (shareActive=true → modal otomatik açılır)
    const url = `https://www.linkedin.com/feed/?shareActive=true`;
    chrome.tabs.create({ url, active: true }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
  });

  return true; // async response için
});

// Uzantı yüklendiğinde bilgi log'la
chrome.runtime.onInstalled.addListener(() => {
  console.log('[CrewinJob LinkedIn] Uzantı yüklendi. Extension ID:', chrome.runtime.id);
});
