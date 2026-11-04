'use strict';

const repo = 'zantexaofficial/Zantexa-Link-Desktop';
const releasePage = `https://github.com/${repo}/releases`;
const apiUrl = `https://api.github.com/repos/${repo}/releases?per_page=10`;
const assetsByPlatform = {
  'windows-x64': (name) => /^Zantexa-Link-Setup-.*\.exe$/i.test(name) && !/-arm64\.exe$/i.test(name),
  'windows-arm64': (name) => /-arm64\.exe$/i.test(name),
  'macos-arm64': (name) => /^Zantexa Link-.*-arm64\.dmg$/i.test(name),
  'macos-x64': (name) => /^Zantexa Link-.*-x64\.dmg$/i.test(name),
  'linux-appimage': (name) => /^Zantexa-Link-.*\.AppImage$/i.test(name),
  'linux-deb': (name) => /^Zantexa-Link-.*\.deb$/i.test(name),
  'linux-arch': (name) => /^twindesk-bin-.*-x86_64\.pkg\.tar\.zst$/i.test(name),
  'android-standard': (name) => /^Zantexa Link-.*\.apk$/i.test(name) && !/-full\.apk$/i.test(name),
  'android-full': (name) => /^Zantexa Link-.*-full\.apk$/i.test(name),
};

const state = document.querySelector('#release-state');
const stateMessage = document.querySelector('#release-message');
const versionLabel = document.querySelector('#version-label');
const downloadLinks = [...document.querySelectorAll('[data-asset]')];

function showUnavailable(message) {
  state.dataset.ready = 'false';
  stateMessage.textContent = message;
  versionLabel.textContent = 'No published builds found';
  for (const link of downloadLinks) {
    link.href = releasePage;
    link.setAttribute('aria-disabled', 'true');
  }
}

async function loadRelease() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Release lookup returned ${response.status}`);
    const releases = await response.json();
    const release = releases.find((item) => !item.draft && !item.prerelease);
    if (!release) {
      showUnavailable('Installers are not published yet. Check the release page for updates.');
      return;
    }

    const assets = release.assets || [];
    let found = 0;
    for (const link of downloadLinks) {
      const matches = assets.find((asset) => assetsByPlatform[link.dataset.asset](asset.name));
      if (!matches) {
        link.href = release.html_url;
        link.setAttribute('aria-disabled', 'true');
        continue;
      }
      link.href = matches.browser_download_url;
      link.removeAttribute('aria-disabled');
      found++;
    }

    state.dataset.ready = found > 0 ? 'true' : 'false';
    stateMessage.textContent = found > 0
      ? `${release.name || release.tag_name} · ${found} packages available`
      : 'This release has no downloadable packages yet.';
    versionLabel.textContent = `Latest release: ${release.tag_name}`;
  } catch (error) {
    showUnavailable('Could not load releases. Use the all releases link below.');
  } finally {
    clearTimeout(timeout);
  }
}

function selectPlatform(platform, focus = false) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const selected = tab.dataset.platform === platform;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const panel of document.querySelectorAll('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== platform;
  }
}

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => selectPlatform(tab.dataset.platform));
  tab.addEventListener('keydown', (event) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : -1;
    if (next >= 0) {
      event.preventDefault();
      selectPlatform(tabs[next].dataset.platform, true);
    }
  });
}

const platform = `${navigator.userAgentData?.platform || navigator.platform || ''}`.toLowerCase();
if (platform.includes('android')) selectPlatform('android');
else if (platform.includes('mac')) selectPlatform('macos');
else if (platform.includes('linux')) selectPlatform('linux');
else selectPlatform('windows');

loadRelease();
