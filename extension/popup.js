/* Popup: launcher, toggle, saved-search editor, live stats from the active tab. */
(() => {
  "use strict";
  const SU = self.JPScout.searchUrl;
  const $ = (id) => document.getElementById(id);
  let cfg = {};

  try { document.querySelector("h1").textContent += " v" + chrome.runtime.getManifest().version; } catch (e) {}

  chrome.storage.local.get({ config: {} }, (got) => {
    cfg = got.config || {};
    $("enabled").checked = cfg.enabled !== false;
    $("url").value = cfg.searchUrl || SU.DEFAULT_SEARCH_URL;
  });

  function saveCfg(patch) {
    // Re-read before writing so we never clobber fields another surface owns
    // (e.g. the content script's pillCollapsed).
    chrome.storage.local.get({ config: {} }, (got) => {
      cfg = { ...(got.config || {}), ...patch };
      chrome.storage.local.set({ config: cfg });
      $("saved").hidden = false;
      setTimeout(() => { $("saved").hidden = true; }, 1200);
    });
  }

  $("open").addEventListener("click", () => {
    chrome.tabs.create({ url: cfg.searchUrl || SU.DEFAULT_SEARCH_URL });
  });
  $("enabled").addEventListener("change", (e) => {
    saveCfg({ enabled: e.target.checked });
  });
  $("save").addEventListener("click", () => {
    const v = $("url").value.trim() || SU.DEFAULT_SEARCH_URL;
    $("url").value = v;
    saveCfg({ searchUrl: v });
  });
  $("reset").addEventListener("click", () => {
    $("url").value = SU.DEFAULT_SEARCH_URL;
    saveCfg({ searchUrl: SU.DEFAULT_SEARCH_URL });
  });

  // --- corrections management ---
  const normO = (o) => ({
    posts: (o && o.posts) || {},
    trustFirms: (o && Array.isArray(o.trustFirms)) ? o.trustFirms : [],
    blockFirms: (o && Array.isArray(o.blockFirms)) ? o.blockFirms : [],
    samples: (o && Array.isArray(o.samples)) ? o.samples : []
  });
  function renderFixes() {
    chrome.storage.local.get({ overrides: {} }, (got) => {
      const o = normO(got.overrides);
      const box = $("fixlists");
      box.textContent = "";
      const addRow = (firm, kind) => {
        const row = document.createElement("div");
        row.className = "row";
        const label = document.createElement("span");
        label.textContent = (kind === "trustFirms" ? "trusted: " : "blocked: ") + firm;
        const x = document.createElement("a");
        x.className = "linklike";
        x.textContent = "remove";
        x.addEventListener("click", () => mutateFixes((oo) => {
          oo[kind] = oo[kind].filter((f) => f !== firm);
        }));
        row.appendChild(label);
        row.appendChild(x);
        box.appendChild(row);
      };
      o.trustFirms.forEach((f) => addRow(f, "trustFirms"));
      o.blockFirms.forEach((f) => addRow(f, "blockFirms"));
      if (!o.trustFirms.length && !o.blockFirms.length) box.textContent = "(no firm rules yet)";
      $("pincount").textContent = Object.keys(o.posts).length + " pinned post(s)";
    });
  }
  function mutateFixes(fn) {
    chrome.storage.local.get({ overrides: {} }, (got) => {
      const o = normO(got.overrides);
      fn(o);
      chrome.storage.local.set({ overrides: o }, renderFixes);
    });
  }
  $("clearpins").addEventListener("click", () => mutateFixes((o) => { o.posts = {}; }));
  $("copyfix").addEventListener("click", () => {
    chrome.storage.local.get({ overrides: {} }, (got) => {
      navigator.clipboard.writeText(JSON.stringify(normO(got.overrides), null, 2)).then(() => {
        $("copyfix").textContent = "Copied ✓";
        setTimeout(() => { $("copyfix").textContent = "Copy corrections (JSON)"; }, 1500);
      });
    });
  });
  renderFixes();

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { type: "jp-stats" }, (resp) => {
      if (chrome.runtime.lastError || !resp) return; // not a LinkedIn tab
      $("stats").textContent = resp.onSearchPage
        ? resp.scanned + " scanned · " + resp.genuine + " genuine · " + resp.junk + " junk · " + resp.seenCount + " seen" + (resp.enabled ? "" : " (overlay off)")
        : "This tab isn't a content search page.";
    });
  });
})();
