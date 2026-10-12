// The "not supported" popup replaces the toolbar click, so it needs its own way into Settings.
document.getElementById('openSettings').onclick = () => {
  chrome.runtime.openOptionsPage();
  window.close();
};
