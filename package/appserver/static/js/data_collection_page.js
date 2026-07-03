/**
 * data_collection_page.js
 * Drives the custom Data Collection page for Splunk_TA_NetApp_ontap.
 *
 * Injects UI into the Splunk chrome rendered by entry_page.js.
 * Waits for the React app shell to mount, then inserts our form into
 * the main content area.
 */
(function () {
  "use strict";

  function makeSplunkUrl(path) {
    if (window.Splunk && window.Splunk.util && window.Splunk.util.make_url) {
      return window.Splunk.util.make_url(path);
    }
    var match = window.location.pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)\//);
    return (match ? "/" + match[1] : "") + path;
  }

  const ADDON   = "Splunk_TA_NetApp_ontap";
  const BASE    = makeSplunkUrl("/splunkd/__raw/servicesNS/nobody/" + ADDON);
  const STANZA  = "data_collection";
  const GLOBAL_CONFIG_URL = makeSplunkUrl("/static/app/" + ADDON + "/js/build/globalConfig.json");

  // Populated at runtime from globalConfig.json — keeps JS in sync with
  // ontap_api_connector.py without any manual edits needed here.
  var INPUT_KINDS = [];

  // ── Load input kinds from globalConfig.json ───────────────────────────────────
  // Mirrors what _build_maps() does in ontap_data_collection_rh.py.
  // A service name like "qtrees" becomes { field: "collect_qtrees", label: "Qtrees" }.
  function loadInputKinds() {
    return fetch(GLOBAL_CONFIG_URL, { credentials: "include" })
      .then(function (r) {
        if (!r.ok) throw new Error("Could not fetch globalConfig.json: " + r.status);
        return r.json();
      })
      .then(function (config) {
        var services = (config.pages && config.pages.inputs && config.pages.inputs.services) || [];
        INPUT_KINDS = services
          .map(function (s) { return s.name && s.name.trim(); })
          .filter(Boolean)
          .map(function (name) {
            // Capitalise each word for a readable label, e.g. "cluster_nodes" → "Cluster Nodes"
            var label = name.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            return { field: "collect_" + name, label: label };
          });
      });
  }


  function injectStyles() {
    if (document.getElementById("dc-styles")) return;
    const s = document.createElement("style");
    s.id = "dc-styles";
    s.textContent = `
      #dc-page {
        max-width: 780px;
        margin: 32px auto;
        padding: 0 24px;
        font-family: "Splunk Platform Sans","Proxima Nova",Arial,sans-serif;
        color: #1a1a1a;
      }
      #dc-page h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 4px; }
      #dc-page .dc-subtitle { color: #6b7280; font-size: 0.9rem; margin-bottom: 24px; }
      .dc-card {
        background: #fff;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 20px 24px;
        margin-bottom: 16px;
      }
      .dc-card-title {
        font-size: 0.9rem; font-weight: 600; color: #111827;
        margin-bottom: 14px; padding-bottom: 8px;
        border-bottom: 1px solid #f3f4f6;
        display: flex; align-items: center; justify-content: space-between;
      }
      .dc-select-btns { display: flex; gap: 6px; }
      .dc-select-btn {
        padding: 2px 10px; border-radius: 3px; font-size: 0.75rem;
        font-weight: 500; cursor: pointer; border: 1px solid #d1d5db;
        background: #fff; color: #374151; transition: background 0.1s;
      }
      .dc-select-btn:hover { background: #f3f4f6; }
      .dc-form-row {
        display: flex; align-items: flex-start;
        margin-bottom: 12px; gap: 12px;
      }
      .dc-form-row > label {
        width: 130px; flex-shrink: 0;
        font-size: 0.85rem; color: #374151; font-weight: 500;
        padding-top: 7px;
      }
      .dc-form-field { flex: 1; }
      .dc-form-field select,
      .dc-form-field input[type="number"] {
        width: 100%; padding: 6px 10px;
        border: 1px solid #d1d5db; border-radius: 4px;
        font-size: 0.85rem; background: #f9fafb; color: #111827;
      }
      .dc-form-field select:focus,
      .dc-form-field input[type="number"]:focus {
        outline: none; border-color: #5469d4;
        box-shadow: 0 0 0 2px rgba(84,105,212,0.18);
      }
      .dc-help { font-size: 0.75rem; color: #9ca3af; margin-top: 3px; }
      .dc-checkbox-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 8px;
      }
      .dc-checkbox-item {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 4px;
        cursor: pointer; user-select: none; transition: background 0.12s;
      }
      .dc-checkbox-item:hover { background: #f3f4f6; }
      .dc-checkbox-item input[type="checkbox"] {
        width: 15px; height: 15px; cursor: pointer; accent-color: #5469d4;
      }
      .dc-checkbox-item span { font-size: 0.85rem; color: #374151; }
      .dc-btn-row {
        display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;
      }
      .dc-btn {
        padding: 7px 18px; border-radius: 4px; font-size: 0.85rem;
        font-weight: 500; cursor: pointer; border: 1px solid transparent;
        transition: background 0.12s;
      }
      .dc-btn-primary { background: #5469d4; color: #fff; border-color: #5469d4; }
      .dc-btn-primary:hover { background: #4356b8; }
      .dc-btn-primary:disabled { background: #a5b0e8; border-color: #a5b0e8; cursor: not-allowed; }
      .dc-btn-secondary { background: #fff; color: #374151; border-color: #d1d5db; }
      .dc-btn-secondary:hover { background: #f3f4f6; }
      #dc-status {
        margin-top: 10px; padding: 9px 13px; border-radius: 4px;
        font-size: 0.85rem; display: none;
      }
      #dc-status.success { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
      #dc-status.error   { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
      #dc-status.loading { background: #e0e7ff; color: #3730a3; border: 1px solid #a5b4fc; }
      .dc-spinner {
        display: inline-block; width: 11px; height: 11px;
        border: 2px solid currentColor; border-right-color: transparent;
        border-radius: 50%; animation: dc-spin 0.6s linear infinite;
        vertical-align: middle; margin-right: 5px;
      }
      @keyframes dc-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(s);
  }

  // ── Build the page HTML ──────────────────────────────────────────────────────
  function buildPage() {
    const div = document.createElement("div");
    div.id = "dc-page";
    div.innerHTML = `
      <h1>Data Collection</h1>
      <p class="dc-subtitle">Configure which NetApp ONTAP data types to collect and how.</p>

      <div class="dc-card">
        <div class="dc-card-title">Collection Settings</div>
        <div class="dc-form-row">
          <label for="dc-account">Account</label>
          <div class="dc-form-field">
            <select id="dc-account"><option value="">— loading… —</option></select>
            <div class="dc-help">Select the ONTAP account. Configure accounts on the Configuration page first.</div>
          </div>
        </div>
        <div class="dc-form-row">
          <label for="dc-index">Index</label>
          <div class="dc-form-field">
            <select id="dc-index"><option value="default">default</option></select>
            <div class="dc-help">Destination Splunk index for collected events.</div>
          </div>
        </div>
        <div class="dc-form-row">
          <label for="dc-interval">Interval (s)</label>
          <div class="dc-form-field">
            <input type="number" id="dc-interval" value="300" min="10" max="3600" />
            <div class="dc-help">How often to collect data, in seconds (10 – 3600).</div>
          </div>
        </div>
        <div class="dc-form-row">
          <label for="dc-request-timeout">Timeout (s)</label>
          <div class="dc-form-field">
            <input type="number" id="dc-request-timeout" value="30" min="1" max="300" />
            <div class="dc-help">Maximum wait time for each ONTAP REST request, in seconds (1 – 300).</div>
          </div>
        </div>
      </div>

      <div class="dc-card">
        <div class="dc-card-title">
          <span>Data Types to Collect</span>
          <div class="dc-select-btns">
            <button class="dc-select-btn" id="dc-btn-select-all">Select all</button>
            <button class="dc-select-btn" id="dc-btn-unselect-all">Unselect all</button>
          </div>
        </div>
        <div class="dc-checkbox-grid" id="dc-checkboxes"></div>
      </div>

      <div id="dc-status"></div>

      <div class="dc-btn-row">
        <button class="dc-btn dc-btn-secondary" id="dc-btn-reset">Reset</button>
        <button class="dc-btn dc-btn-primary"   id="dc-btn-save">Create / Update Inputs</button>
      </div>
    `;
    return div;
  }

  // ── Wait for React to mount the app shell, then inject our page ──────────────
  function mountPage() {
    if (document.getElementById("dc-page")) return;
    injectStyles();
    const page = buildPage();
    var mainContainer = document.querySelector('div[role="main"]');
    console.log("[DC] mountPage — mainContainer=", mainContainer, " body.innerHTML[:200]=", document.body.innerHTML.substring(0, 200));
    if (mainContainer) {
      mainContainer.appendChild(page);
      console.log("[DC] appended to div[role=main]");
    } else {
      document.body.appendChild(page);
      console.log("[DC] fallback: appended to body");
    }
    wireEvents();
    init();
  }

  // ── DOM references (lazy — called after mountPage) ───────────────────────────
  function el(id) { return document.getElementById(id); }

  // ── Helper: fetch ────────────────────────────────────────────────────────────
  function getFormKey() {
    if (window.Splunk && window.Splunk.util && window.Splunk.util.getFormKey) {
      return window.Splunk.util.getFormKey();
    }
    var match = document.cookie.match(/(?:^|;\s*)splunkweb_csrf_token_[^=]+=([^\s;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function apiFetch(url, opts) {
    opts = Object.assign({ credentials: "include" }, opts || {});
    opts.headers = Object.assign({ "X-Requested-With": "XMLHttpRequest" }, opts.headers || {});
    if (String(opts.method || "GET").toUpperCase() !== "GET") {
      var formKey = getFormKey();
      if (formKey) opts.headers["X-Splunk-Form-Key"] = formKey;
    }
    return fetch(url, opts)
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ": " + t); });
        return r.json();
      });
  }

  // ── Status ───────────────────────────────────────────────────────────────────
  function showStatus(msg, type) {
    const e = el("dc-status");
    e.className = type || "loading";
    e.style.display = "block";
    e.innerHTML = (type === "loading" ? '<span class="dc-spinner"></span>' : "") + msg;
  }
  function clearStatus() { el("dc-status").style.display = "none"; }

  // ── Build checkboxes ─────────────────────────────────────────────────────────
  function buildCheckboxes() {
    const grid = el("dc-checkboxes");
    grid.innerHTML = "";
    INPUT_KINDS.forEach(function (k) {
      const lbl = document.createElement("label");
      lbl.className = "dc-checkbox-item";
      lbl.innerHTML =
        '<input type="checkbox" id="chk-' + k.field + '" data-field="' + k.field + '" checked />' +
        "<span>" + k.label + "</span>";
      grid.appendChild(lbl);
    });
  }

  // ── Load accounts ────────────────────────────────────────────────────────────
  function loadAccounts() {
    return apiFetch(BASE + "/Splunk_TA_NetApp_ontap_account?output_mode=json&count=0")
      .then(function (data) {
        const sel = el("dc-account");
        sel.innerHTML = '<option value="">— Select account —</option>';
        (data.entry || []).forEach(function (e) {
          const o = document.createElement("option");
          o.value = e.name; o.textContent = e.name;
          sel.appendChild(o);
        });
      });
  }

  // ── Load indexes ─────────────────────────────────────────────────────────────
  function loadIndexes() {
    return apiFetch(makeSplunkUrl("/splunkd/__raw/services/data/indexes?output_mode=json&count=0&search=isInternal%3D0"))
      .then(function (data) {
        const sel = el("dc-index");
        const current = sel.value;
        sel.innerHTML = "";
        (data.entry || []).forEach(function (e) {
          const o = document.createElement("option");
          o.value = e.name; o.textContent = e.name;
          sel.appendChild(o);
        });
        if (!sel.querySelector('option[value="default"]')) {
          const def = document.createElement("option");
          def.value = "default"; def.textContent = "default";
          sel.insertBefore(def, sel.firstChild);
        }
        sel.value = current || "default";
      });
  }

  // ── Load saved settings ──────────────────────────────────────────────────────
  function loadSettings() {
    return apiFetch(BASE + "/Splunk_TA_NetApp_ontap_settings/" + STANZA + "?output_mode=json")
      .then(function (data) {
        const c = (data.entry && data.entry[0] && data.entry[0].content) || {};
        if (c.account)  el("dc-account").value  = c.account;
        if (c.index)    el("dc-index").value    = c.index;
        if (c.interval) el("dc-interval").value = c.interval;
        if (c.request_timeout) el("dc-request-timeout").value = c.request_timeout;
        INPUT_KINDS.forEach(function (k) {
          const chk = el("chk-" + k.field);
          if (!chk) return;
          const v = String(c[k.field] !== undefined ? c[k.field] : "1");
          chk.checked = v === "1" || v === "true" || v === "True";
        });
      })
      .catch(function (e) { console.warn("Could not load saved settings:", e); });
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  function isIntegerInRange(value, min, max) {
    var n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max;
  }

  function saveSettings() {
    const account  = el("dc-account").value.trim();
    const index    = el("dc-index").value.trim() || "default";
    const interval = el("dc-interval").value.trim() || "300";
    const requestTimeout = el("dc-request-timeout").value.trim() || "30";
    if (!account) { showStatus("Please select an account before saving.", "error"); return; }
    if (!isIntegerInRange(interval, 10, 3600)) { showStatus("Interval must be between 10 and 3600 seconds.", "error"); return; }
    if (!isIntegerInRange(requestTimeout, 1, 300)) { showStatus("Timeout must be between 1 and 300 seconds.", "error"); return; }

    showStatus("Saving and syncing inputs…");
    el("dc-btn-save").disabled = true;

    const params = new URLSearchParams({ output_mode: "json", account, index, interval, request_timeout: requestTimeout });
    INPUT_KINDS.forEach(function (k) {
      const chk = el("chk-" + k.field);
      params.append(k.field, chk && chk.checked ? "1" : "0");
    });

    apiFetch(BASE + "/Splunk_TA_NetApp_ontap_settings/" + STANZA, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
      .then(function () { showStatus("Inputs created / updated successfully.", "success"); })
      .catch(function (e) { showStatus("Error: " + e.message, "error"); })
      .finally(function () { el("dc-btn-save").disabled = false; });
  }

  // ── Wire buttons ─────────────────────────────────────────────────────────────
  function wireEvents() {
    el("dc-btn-save").addEventListener("click", function () { clearStatus(); saveSettings(); });
    el("dc-btn-reset").addEventListener("click", function () { clearStatus(); loadData(); });
    el("dc-btn-select-all").addEventListener("click", function () {
      INPUT_KINDS.forEach(function (k) {
        var chk = el("chk-" + k.field);
        if (chk) chk.checked = true;
      });
    });
    el("dc-btn-unselect-all").addEventListener("click", function () {
      INPUT_KINDS.forEach(function (k) {
        var chk = el("chk-" + k.field);
        if (chk) chk.checked = false;
      });
    });
  }

  // ── Load all data ────────────────────────────────────────────────────────────
  function loadData() {
    showStatus("Loading…");
    loadInputKinds()
      .then(function () {
        buildCheckboxes();
        return Promise.all([loadAccounts(), loadIndexes()]);
      })
      .then(loadSettings)
      .then(clearStatus)
      .catch(function (e) { showStatus("Failed to load page: " + e.message, "error"); });
  }

  function init() { loadData(); }

  // ── Wait for Splunk layout to finish rendering, then inject our page ─────────
  // entry_page.js loads layout.js asynchronously. layout.js creates:
  //   - header[data-view="splunkjs/mvc/headerview"]  (the top nav bar)
  //   - div[role="main"]  (the page content container we need to append into)
  // We poll until div[role="main"] exists, then inject our content there.
  function waitAndMount() {
    if (document.getElementById("dc-page")) return;
    console.log("[DC] waitAndMount started, readyState=", document.readyState);

    var attempts = 0;
    var maxAttempts = 150;
    var timer = setInterval(function () {
      attempts++;
      var mainContainer = document.querySelector('div[role="main"]');
      var header = document.querySelector('header[data-view="splunkjs/mvc/headerview"]');
      if (attempts % 10 === 0) {
        console.log("[DC] poll #" + attempts + " main=", !!mainContainer, " header=", !!header,
          " body.children=", document.body.children.length,
          Array.from(document.body.children).map(function(el){ return el.tagName + (el.id ? "#"+el.id : "") + (el.getAttribute("role") ? "[role="+el.getAttribute("role")+"]" : "") + (el.getAttribute("data-view") ? "[data-view="+el.getAttribute("data-view")+"]" : ""); }).join(", "));
      }
      if (mainContainer || attempts >= maxAttempts) {
        clearInterval(timer);
        console.log("[DC] mounting — found main=", !!mainContainer, " after", attempts, "attempts");
        mountPage();
      }
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitAndMount);
  } else {
    waitAndMount();
  }
})();
