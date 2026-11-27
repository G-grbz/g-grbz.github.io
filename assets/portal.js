/* G-grbz shared page script
   - TR/EN switch (data-tr, data-tr-label, data-tr-href, data-tr-content)
   - Light/dark theme switch
   - Copy buttons, setup accordions, "on this page" highlighting
   Reusable by any page that loads assets/styles.css (e.g. future demos). */

const root = document.documentElement;
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

/* ---------- Language ---------- */

const UI = {
  en: {
    copied: "Copied",
    copiedStatus: "Text copied to the clipboard.",
    selected: "Selected",
    selectedStatus: "Text selected. Press Ctrl+C or ⌘C to copy it.",
    langSwitch: "Türkçe'ye geç",
    variables: (shown, total) => (shown === total ? `${total} variables` : `${shown} of ${total}`),
    defaultLabel: "Default",
    themeToLight: "Switch to light theme",
    themeToDark: "Switch to dark theme",
  },
  tr: {
    copied: "Kopyalandı",
    copiedStatus: "Metin panoya kopyalandı.",
    selected: "Seçildi",
    selectedStatus: "Metin seçildi. Kopyalamak için Ctrl+C veya ⌘C tuşlarını kullanın.",
    langSwitch: "Switch to English",
    variables: (shown, total) => (shown === total ? `${total} değişken` : `${shown} / ${total}`),
    defaultLabel: "Varsayılan",
    themeToLight: "Açık temaya geç",
    themeToDark: "Koyu temaya geç",
  },
};

const translatable = {
  text: [...document.querySelectorAll("[data-tr]")],
  label: [...document.querySelectorAll("[data-tr-label]")],
  href: [...document.querySelectorAll("[data-tr-href]")],
  meta: [...document.querySelectorAll("meta[data-tr-content]")],
  placeholder: [...document.querySelectorAll("[data-tr-placeholder]")],
};

// Remember the English source so the page can switch back without reloading.
for (const el of translatable.text) el.dataset.en = el.textContent;
for (const el of translatable.label) el.dataset.enLabel = el.getAttribute("aria-label") ?? "";
for (const el of translatable.href) el.dataset.enHref = el.getAttribute("href");
for (const el of translatable.meta) el.dataset.enContent = el.content;
for (const el of translatable.placeholder) el.dataset.enPlaceholder = el.placeholder;

let lang = store.get("lang") || (/^tr(?:-|$)/i.test(navigator.language) ? "tr" : "en");

function applyLanguage(next) {
  lang = next;
  const tr = lang === "tr";
  root.lang = lang;
  for (const el of translatable.text) el.textContent = tr ? el.dataset.tr : el.dataset.en;
  for (const el of translatable.label) el.setAttribute("aria-label", tr ? el.dataset.trLabel : el.dataset.enLabel);
  for (const el of translatable.href) el.setAttribute("href", tr ? el.dataset.trHref : el.dataset.enHref);
  for (const el of translatable.meta) el.content = tr ? el.dataset.trContent : el.dataset.enContent;
  for (const el of translatable.placeholder) el.placeholder = tr ? el.dataset.trPlaceholder : el.dataset.enPlaceholder;
  updateControls();
  document.dispatchEvent(new CustomEvent("languagechange", { detail: { lang } }));
  root.classList.remove("tr-pending");
}

/* ---------- Theme ---------- */

const themeColor = document.querySelector('meta[name="theme-color"]');

function applyTheme(theme) {
  root.dataset.theme = theme;
  if (themeColor) themeColor.content = theme === "dark" ? "#08110f" : "#f6f8f7";
  updateControls();
}

/* ---------- Header controls ---------- */

const icons = {
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.75 5.7 3.75 9S14.5 18.3 12 21c-2.5-2.7-3.75-5.7-3.75-9S9.5 5.7 12 3Z"/></svg>',
  sun: '<svg class="theme-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  moon: '<svg class="theme-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
};

const nav = document.querySelector(".site-header .nav");
let langButton;
let themeButton;

if (nav) {
  const controls = document.createElement("div");
  controls.className = "nav-controls";

  langButton = document.createElement("button");
  langButton.type = "button";
  langButton.className = "control control-lang";
  langButton.addEventListener("click", () => {
    const next = lang === "tr" ? "en" : "tr";
    store.set("lang", next);
    applyLanguage(next);
  });

  themeButton = document.createElement("button");
  themeButton.type = "button";
  themeButton.className = "control control-theme";
  themeButton.innerHTML = icons.sun + icons.moon;
  themeButton.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    store.set("theme", next);
    applyTheme(next);
  });

  controls.append(langButton, themeButton);
  nav.append(controls);
}

function updateControls() {
  const ui = UI[lang];
  if (langButton) {
    langButton.innerHTML = `${icons.globe}<span>${lang.toUpperCase()}</span>`;
    langButton.setAttribute("aria-label", ui.langSwitch);
    langButton.title = ui.langSwitch;
  }
  if (themeButton) {
    const label = root.dataset.theme === "dark" ? ui.themeToLight : ui.themeToDark;
    themeButton.setAttribute("aria-label", label);
    themeButton.title = label;
  }
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
  if (!store.get("theme")) applyTheme(event.matches ? "dark" : "light");
});

applyTheme(root.dataset.theme === "dark" ? "dark" : "light");
applyLanguage(lang);

/* ---------- Setup accordions ---------- */

function openSetupFromHash() {
  const panel = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  if (panel instanceof HTMLDetailsElement && !panel.open) {
    panel.open = true;
    panel.scrollIntoView();
  }
}

window.addEventListener("hashchange", openSetupFromHash);
openSetupFromHash();

for (const link of document.querySelectorAll('.project-links a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const panel = document.getElementById(link.hash.slice(1));
    if (panel instanceof HTMLDetailsElement) panel.open = true;
  });
}

/* ---------- Package install tabs ---------- */

const platform = /Android/i.test(navigator.userAgent) ? 'android' : /Windows/i.test(navigator.userAgent) ? 'windows' : /Linux|X11|CrOS/i.test(navigator.userAgent) ? 'linux' : null;

for (const box of document.querySelectorAll("[data-pkg]")) {
  const tabs = [...box.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length], true);
    });
  });
  select(tabs.find((t) => t.dataset.os === platform) || tabs[0]);
  box.classList.add("is-ready");
}

/* ---------- Direct downloads of the latest release ---------- */
// Buttons link to the release page; with the GitHub API they point straight
// at the newest file whose name matches (names contain the version).

const releaseCache = new Map();
function latestRelease(repo) {
  if (!releaseCache.has(repo)) {
    releaseCache.set(repo, (async () => {
      const key = `release:${repo}`;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "null");
        if (saved && Date.now() - saved.at < 30 * 60 * 1000) return saved.data;
      } catch {}
      const res = await fetch(`https://api.github.com/repos/G-grbz/${repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const body = await res.json();
      const data = { tag: body.tag_name, assets: (body.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
      try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch {}
      return data;
    })());
  }
  return releaseCache.get(repo);
}

const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

for (const link of document.querySelectorAll("a[data-asset-repo]")) {
  const info = link.parentElement.querySelector("[data-asset-info]");
  latestRelease(link.dataset.assetRepo)
    .then((release) => {
      const pattern = new RegExp(link.dataset.assetMatch);
      const asset = release.assets.find((a) => pattern.test(a.name));
      if (!asset) return;
      link.href = asset.url;
      if (info) info.textContent = `${asset.name} · ${formatSize(asset.size)}`;
    })
    .catch(() => {});
}

/* ---------- Copy buttons ---------- */

const copyStatus = document.getElementById("copy-status");

for (const button of document.querySelectorAll(".copy")) {
  const code = button.closest(".command").querySelector("code");
  const label = button.lastElementChild;
  let resetLabel;

  button.hidden = false;
  button.addEventListener("click", async () => {
    const ui = UI[lang];
    window.clearTimeout(resetLabel);
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.classList.add("is-copied");
      label.textContent = ui.copied;
      if (copyStatus) copyStatus.textContent = ui.copiedStatus;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.classList.remove("is-copied");
      label.textContent = ui.selected;
      if (copyStatus) copyStatus.textContent = ui.selectedStatus;
    }

    resetLabel = window.setTimeout(() => {
      button.classList.remove("is-copied");
      label.textContent = lang === "tr" ? label.dataset.tr : label.dataset.en;
      if (copyStatus) copyStatus.textContent = "";
    }, 2200);
  });
}

/* ---------- "On this page" highlighting ---------- */

const tocLinks = [...document.querySelectorAll(".guide-toc a[href^='#']")];

if (tocLinks.length && "IntersectionObserver" in window) {
  const sections = tocLinks
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter(Boolean);
  const visible = new Set();

  const setActive = () => {
    const current = sections.find((section) => visible.has(section)) ?? null;
    for (const link of tocLinks) {
      const active = current && link.hash === `#${current.id}`;
      link.classList.toggle("is-active", Boolean(active));
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    setActive();
  }, { rootMargin: "-80px 0px -55% 0px" });

  for (const section of sections) observer.observe(section);
}

/* ---------- Environment variable search ---------- */

const envFilter = document.querySelector(".env-filter");

if (envFilter) {
  const input = envFilter.querySelector("input");
  const count = envFilter.querySelector(".env-count");
  const section = envFilter.closest("section");
  const groups = [...section.querySelectorAll(".env-group")];
  const rows = groups.flatMap((group) => [...group.querySelectorAll("tbody tr")]);
  const empty = section.querySelector(".env-empty");
  const index = section.querySelector(".env-index");
  const normalize = (text) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");

  const update = () => {
    const terms = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const row of rows) {
      const text = normalize(row.textContent);
      const match = terms.every((term) => text.includes(term));
      row.hidden = !match;
      if (match) shown += 1;
    }
    for (const group of groups) group.hidden = !group.querySelector("tbody tr:not([hidden])");
    if (empty) empty.hidden = shown > 0;
    if (index) index.hidden = terms.length > 0;
    count.textContent = UI[lang].variables(shown, rows.length);
    for (const cell of section.querySelectorAll(".env-default")) cell.dataset.label = UI[lang].defaultLabel;
  };

  envFilter.hidden = false;
  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      input.value = "";
      update();
    }
  });
  document.addEventListener("languagechange", update);
  update();
}
