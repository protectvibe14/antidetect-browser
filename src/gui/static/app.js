/* =====================================================================
 * AntiDetect dashboard — vanilla JS client for the local FastAPI backend.
 * Design language adapted from persona-studio (MIT):
 * https://github.com/anhnnp/persona-studio (commit d46e984cfbdcd7278063e793e6ab1ad95b8cdc78)
 * API shapes documented in ../README.md
 * =================================================================== */
"use strict";

/* ---------------- API client (same-origin; backend serves statics at "/") ---------------- */
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function req(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      body,
      ...(opts.raw ? {} : { headers: { "Content-Type": "application/json" } }),
    });
  } catch (e) {
    throw new ApiError(0, "Backend unreachable — is it running on this host?");
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const msg = (data && data.error) || ("HTTP " + res.status);
    throw new ApiError(res.status, msg);
  }
  if (data && data.error) throw new ApiError(res.status, data.error);
  return data;
}

const api = {
  listProfiles: () => req("GET", "/api/profiles").then(d => d.profiles || []),
  createProfile: (p) => req("POST", "/api/profiles", JSON.stringify(p)),
  deleteProfile: (name) => req("DELETE", "/api/profiles/" + encodeURIComponent(name)),
  launch: (name) => req("POST", "/api/profiles/" + encodeURIComponent(name) + "/launch"),
  stop: (name) => req("POST", "/api/profiles/" + encodeURIComponent(name) + "/stop"),
  health: (name) => req("GET", "/api/profiles/" + encodeURIComponent(name) + "/health"),
  listProxies: () => req("GET", "/api/proxies").then(d => d.proxies || []),
  bulkImport: (file, clientTag) => {
    const fd = new FormData();
    fd.append("file", file);
    if (clientTag) fd.append("client_tag", clientTag);
    return req("POST", "/api/bulk/import", fd, { raw: true });
  },
  syncStart: (p) => req("POST", "/api/sync/start", JSON.stringify(p)),
  syncStop: (id) => req("POST", "/api/sync/stop", JSON.stringify({ session_id: id })),
  syncStatus: (id) => req("GET", "/api/sync/status" + (id ? "?session_id=" + encodeURIComponent(id) : "")),
  syncTyping: (id, enabled) => req("POST", "/api/sync/typing", JSON.stringify({ session_id: id, enabled })),
};

/* ---------------- State ---------------- */
const state = {
  profiles: [],
  proxies: [],
  query: "",
  tag: null,            // null = All profiles; "__untagged__" = no tag; else the tag string
  proxiesLoaded: false,
  syncSessionId: null,  // active sync session, if any
};

/* ---------------- DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function toast(message, kind = "info") {
  const el = document.createElement("div");
  el.className = "ps-toast " + (kind === "error" ? "error" : kind === "success" ? "success" : "");
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 3800);
  setTimeout(() => el.remove(), 4300);
}

function relTime(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return new Date(t).toLocaleDateString();
}

function scoreClass(score) {
  if (score == null) return "warn";
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

/* ---------------- Rendering ---------------- */
function distinctTags() {
  const counts = new Map();
  for (const p of state.profiles) {
    const key = p.client_tag || "__untagged__";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderTags() {
  const list = $("tag-list");
  const tags = distinctTags();
  const allActive = state.tag === null ? " active" : "";
  let html = `<button class="ps-folder${allActive}" data-tag="">
    <span class="ps-tag-ic">&#9638;</span><span class="ps-folder-label">All profiles</span>
    <span class="ps-count">${state.profiles.length}</span></button>`;
  for (const [key, n] of tags) {
    const label = key === "__untagged__" ? "Untagged" : key;
    const active = state.tag === key ? " active" : "";
    html += `<button class="ps-folder${active}" data-tag="${esc(key)}">
      <span class="ps-tag-ic">&#9672;</span><span class="ps-folder-label">${esc(label)}</span>
      <span class="ps-count">${n}</span></button>`;
  }
  list.innerHTML = html;
  list.querySelectorAll(".ps-folder").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.tag;
      state.tag = v === "" ? null : v;
      renderAll();
    });
  });
  const crumb = state.tag === null ? "All profiles"
    : state.tag === "__untagged__" ? "Untagged" : state.tag;
  $("crumb-tag").textContent = crumb;
}

function matches(p) {
  if (state.tag !== null) {
    const key = p.client_tag || "__untagged__";
    if (key !== state.tag) return false;
  }
  if (state.query) {
    const q = state.query.toLowerCase();
    const hay = (p.name + " " + (p.client_tag || "")).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderStats() {
  $("stat-profiles").textContent = state.profiles.length;
  const running = state.profiles.filter(p => p.status === "running").length;
  $("stat-running").textContent = running;
  $("stat-proxies").textContent = state.proxies.length;
  $("stat-running-ic").style.color = running > 0 ? "" : "var(--dim)";
}

function statusCell(p) {
  const st = p.status || "stopped";
  const label = st.charAt(0).toUpperCase() + st.slice(1);
  return `<span class="ps-status-dot ${esc(st)}"></span><span class="ps-status-label">${esc(label)}</span>`;
}

function renderTable() {
  const body = $("profiles-body");
  const rows = state.profiles.filter(matches);
  if (rows.length === 0) {
    const empty = state.profiles.length === 0
      ? `<div class="ps-empty"><div>No profiles yet.</div>
         <button class="ps-btn primary sm" id="empty-new">+ Create one</button></div>`
      : `<div class="ps-empty"><div>No profiles match your search or tag filter.</div></div>`;
    body.innerHTML = `<tr><td colspan="7">${empty}</td></tr>`;
    const b = $("empty-new");
    if (b) b.addEventListener("click", () => openModal("modal-new"));
    return;
  }
  body.innerHTML = rows.map(p => {
    const name = esc(p.name);
    const starting = p.status === "starting";
    const running = p.status === "running";
    const launchBtn = starting
      ? `<button class="ps-btn ghost sm" disabled>Starting&hellip;</button>`
      : running
        ? `<button class="ps-btn ghost sm" data-act="stop">&#9632; Stop</button>`
        : `<button class="ps-btn primary sm" data-act="launch">&#9654; Launch</button>`;
    const tag = p.client_tag
      ? `<span class="ps-tag">${esc(p.client_tag)}</span>`
      : `<span class="ps-tag none">&mdash;</span>`;
    const proxy = p.proxy_label
      ? `<span class="ps-proxy"><span class="ps-proxy-ic">&#8646;</span>${esc(p.proxy_label)}</span>`
      : `<span class="ps-proxy off">Direct</span>`;
    return `<tr data-name="${name}">
      <td>${statusCell(p)}</td>
      <td><div class="ps-name-row"><span class="ps-name">${name}</span></div></td>
      <td>${tag}</td>
      <td><span class="ps-os">${esc(p.os || "?")}</span></td>
      <td>${proxy}</td>
      <td><span class="ps-mono dim">${esc(relTime(p.last_used))}</span></td>
      <td><div class="ps-actions">
        ${launchBtn}
        <button class="ps-btn ghost sm" data-act="health">&#10003; Health</button>
        <button class="ps-btn danger sm" data-act="delete">&#10005;</button>
      </div></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr[data-name]").forEach(tr => {
    const name = tr.dataset.name;
    tr.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => onAction(name, btn.dataset.act));
    });
  });
}

function renderAll() {
  renderTags();
  renderStats();
  renderTable();
}

/* ---------------- Actions ---------------- */
async function onAction(name, act) {
  try {
    if (act === "launch") {
      await api.launch(name);
      toast(`Launching "${name}"…`, "success");
    } else if (act === "stop") {
      await api.stop(name);
      toast(`Stopped "${name}".`, "success");
    } else if (act === "delete") {
      if (!confirm(`Delete profile "${name}"? This cannot be undone.`)) return;
      await api.deleteProfile(name);
      toast(`Deleted "${name}".`, "success");
    } else if (act === "health") {
      openHealth(name);
      return; // no immediate refresh needed
    }
    await refreshProfiles();
  } catch (e) {
    toast(actionError(act, name, e), "error");
  }
}

function actionError(act, name, e) {
  const base = `Failed to ${act} "${name}": ${e.message || e}`;
  if (act === "delete" && e.status === 409) return `Cannot delete "${name}": stop it first. (${e.message})`;
  if (e.status === 404) return `"${name}" not found (it may already be gone).`;
  return base;
}

/* ---------------- Refresh loop ---------------- */
let refreshing = false;
async function refreshProfiles() {
  if (refreshing) return;
  refreshing = true;
  try {
    state.profiles = await api.listProfiles();
    setConn(true);
  } catch (e) {
    setConn(false);
    // Only toast on the first failure of a quiet stretch to avoid spam every 5s.
    if (!refreshProfiles._failed) toast("Cannot reach backend: " + (e.message || e), "error");
    refreshProfiles._failed = true;
    return;
  } finally { refreshing = false; }
  refreshProfiles._failed = false;
  renderAll(); // preserves search text + selected tag (both live in state)
}

function setConn(up) {
  const foot = $("conn-foot");
  foot.classList.toggle("live", up);
  foot.classList.toggle("down", !up);
  $("conn-label").textContent = up ? "Backend online" : "Backend offline";
  $("refresh-note").textContent = up ? "auto-refresh 5s" : "";
}

setInterval(refreshProfiles, 5000);

/* ---------------- Modals ---------------- */
function openModal(id) {
  if (id === "modal-new") loadProxyOptions();
  $(id).hidden = false;
  const first = $(id).querySelector("input[type=text], select");
  if (first) setTimeout(() => first.focus(), 50);
}
function closeModal(el) {
  const bd = el.closest(".ps-overlay");
  if (bd) bd.hidden = true;
}
document.querySelectorAll("[data-close]").forEach(b =>
  b.addEventListener("click", () => closeModal(b)));
document.querySelectorAll(".ps-overlay").forEach(bd =>
  bd.addEventListener("mousedown", (e) => { if (e.target === bd) bd.hidden = true; }));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".ps-overlay").forEach(bd => bd.hidden = true);
});

async function loadProxyOptions() {
  const sel = $("new-proxy");
  try {
    state.proxies = await api.listProxies();
    state.proxiesLoaded = true;
  } catch { /* keep whatever we had; proxies optional */ }
  const cur = sel.value;
  sel.innerHTML = `<option value="">None (direct)</option>` + state.proxies.map(p =>
    `<option value="${esc(p.name)}">${esc(p.name)} (${esc(p.type)}://${esc(p.host)}:${esc(p.port)})</option>`
  ).join("");
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/* ---------------- New profile ---------------- */
$("form-new").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: $("new-name").value.trim(),
    os: $("new-os").value,
  };
  const proxyName = $("new-proxy").value;
  const tag = $("new-tag").value.trim();
  if (proxyName) payload.proxy_name = proxyName;
  if (tag) payload.client_tag = tag;
  if (!payload.name) { toast("Profile name is required.", "error"); return; }
  try {
    await api.createProfile(payload);
    toast(`Created "${payload.name}".`, "success");
    closeModal(e.target);
    e.target.reset();
    await refreshProfiles();
  } catch (err) {
    toast("Create failed: " + (err.message || err), "error");
  }
});

/* ---------------- Bulk import ---------------- */
$("form-bulk").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("bulk-file").files[0];
  if (!file) { toast("Choose a CSV file first.", "error"); return; }
  const tag = $("bulk-tag").value.trim();
  const box = $("bulk-result");
  box.hidden = false;
  box.innerHTML = "Importing&hellip;";
  try {
    const res = await api.bulkImport(file, tag);
    const created = res.created || 0, skipped = res.skipped || 0;
    const errors = Array.isArray(res.errors) ? res.errors : [];
    box.innerHTML =
      `<span class="ok">Created: ${created}</span> &middot; ` +
      `<span class="warn">Skipped: ${skipped}</span> &middot; ` +
      `<span class="${errors.length ? "err" : ""}">Errors: ${errors.length}</span>` +
      (errors.length
        ? `<ul>${errors.slice(0, 12).map(x => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}` +
          (errors.length > 12 ? `<li>&hellip;and ${errors.length - 12} more</li>` : "") + `</ul>`
        : "");
    toast(`Import done: ${created} created, ${skipped} skipped, ${errors.length} errors.`,
      errors.length ? "info" : "success");
    await refreshProfiles();
  } catch (err) {
    box.innerHTML = `<span class="err">Import failed: ${esc(err.message || err)}</span>`;
    toast("Import failed: " + (err.message || err), "error");
  }
});

/* ---------------- Health modal ---------------- */
async function openHealth(name) {
  $("health-title").textContent = name;
  $("health-body").innerHTML = `<div class="ps-empty">Loading health&hellip;</div>`;
  openModal("modal-health");
  try {
    const h = await api.health(name);
    $("health-body").innerHTML = renderHealth(h);
  } catch (e) {
    $("health-body").innerHTML =
      `<div class="ps-empty">Health check failed: ${esc(e.message || e)}</div>`;
  }
}

function renderHealth(h) {
  const score = typeof h.score === "number" ? h.score : null;
  const cls = scoreClass(score);
  const consistency = Array.isArray(h.consistency) ? h.consistency : [];
  const passed = consistency.filter(c => c.passed).length;
  const detection = h.detection && typeof h.detection === "object" ? h.detection : {};

  const checksHtml = consistency.length === 0
    ? `<div class="ps-check"><span class="ps-check-ic">?</span><div><div class="ps-check-name">No consistency data</div></div></div>`
    : consistency.map(c => {
      const ok = !!c.passed;
      const nm = esc(c.check || c.name || "check");
      const detail = c.detail ? `<div class="ps-check-detail">${esc(String(c.detail))}</div>` : "";
      return `<div class="ps-check ${ok ? "ok" : "fail"}">
        <span class="ps-check-ic">${ok ? "&#10003;" : "&#10005;"}</span>
        <div><div class="ps-check-name">${nm}</div>${detail}</div></div>`;
    }).join("");

  const detectHtml = Object.keys(detection).length === 0
    ? `<div class="ps-check"><span class="ps-check-ic">?</span><div><div class="ps-check-name">No detection data</div></div></div>`
    : Object.entries(detection).map(([site, d]) => {
      const verdict = String((d && (d.verdict || d.status || d.result)) || "unknown").toLowerCase();
      const vcls = verdict.includes("clean") ? "clean"
        : verdict.includes("suspicious") ? "suspicious"
        : (verdict.includes("bot") || verdict.includes("lie")) ? "bot" : "unknown";
      const noteBits = [];
      if (d && d.signals) noteBits.push("signals: " + JSON.stringify(d.signals));
      if (d && d.page_reached === false) noteBits.push("page not reached");
      if (d && d.reason) noteBits.push(String(d.reason));
      if (d && d.detail) noteBits.push(String(d.detail));
      return `<div class="ps-detect-card">
        <div class="ps-detect-name">${esc(site)}</div>
        <div class="ps-detect-verdict ${vcls}">${esc(verdict)}</div>
        ${noteBits.length ? `<div class="ps-detect-note">${esc(noteBits.join(" · "))}</div>` : ""}
      </div>`;
    }).join("");

  return `
    <div class="ps-health-score-wrap">
      <div class="ps-health-score ${cls}">${score == null ? "?" : score}</div>
      <div class="ps-health-meta">
        <div>Consistency: <b>${passed}/${consistency.length}</b> checks passed</div>
        <div>Detection verdicts below</div>
      </div>
    </div>
    <div class="ps-health-sec">Consistency</div>
    <div class="ps-check-list">${checksHtml}</div>
    <div class="ps-health-sec">Detection</div>
    <div class="ps-detect-grid">${detectHtml}</div>`;
}

/* ---------------- Top bar wiring ---------------- */
$("btn-new").addEventListener("click", () => openModal("modal-new"));
$("btn-sync").addEventListener("click", () => openSync());
$("btn-bulk").addEventListener("click", () => {
  $("bulk-result").hidden = true;
  $("bulk-result").innerHTML = "";
  openModal("modal-bulk");
});
$("search").addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  renderTags();   // keep counts accurate
  renderTable();  // live filter, no refetch
});

/* ---------------- Sync modal ---------------- */
function syncProfileOptions(exclude) {
  return state.profiles
    .filter(p => p.name !== exclude)
    .map(p => {
      const busy = p.status === "running" || p.status === "starting";
      return `<option value="${esc(p.name)}"${busy ? " disabled" : ""}>${esc(p.name)}${busy ? " (running)" : ""}</option>`;
    }).join("");
}

function openSync() {
  const masterSel = $("sync-master");
  masterSel.innerHTML = syncProfileOptions(null) || `<option value="">No profiles yet</option>`;
  renderSyncFollowers();
  masterSel.onchange = renderSyncFollowers;
  refreshSyncStatus();
  openModal("modal-sync");
}

function renderSyncFollowers() {
  const master = $("sync-master").value;
  const box = $("sync-followers");
  const rows = state.profiles.filter(p => p.name !== master);
  if (rows.length === 0) {
    box.innerHTML = `<div class="ps-empty">No other profiles to mirror to.</div>`;
    return;
  }
  box.innerHTML = rows.map(p => {
    const busy = p.status === "running" || p.status === "starting";
    return `<label class="ps-check${busy ? " off" : ""}">
      <input type="checkbox" value="${esc(p.name)}"${busy ? " disabled" : ""}>
      <span class="ps-check-name">${esc(p.name)}${busy ? " (running)" : ""}</span>
    </label>`;
  }).join("");
}

function renderSyncStatus(st) {
  const box = $("sync-status");
  const stopBtn = $("btn-sync-stop");
  const startBtn = $("btn-sync-start");
  if (!st) {
    box.hidden = true;
    box.innerHTML = "";
    stopBtn.hidden = true;
    startBtn.disabled = false;
    return;
  }
  const frows = Object.entries(st.followers || {}).map(([n, f]) =>
    `${esc(n)}: ${esc(f.state)} (mirrored ${f.mirrored}, dropped ${f.dropped}, queued ${f.queue_depth})`
  ).join("<br>");
  box.hidden = false;
  box.innerHTML =
    `<span class="ok">Session ${esc(st.session_id)}</span> &middot; ` +
    `master <b>${esc(st.master)}</b> &middot; ` +
    `mirrored <b>${st.mirrored_total}</b> &middot; ` +
    `typing ${st.typing_enabled ? "on" : "off"} &middot; ` +
    `${st.alive ? "alive" : "stopped"}<br>${frows}` +
    (st.last_error ? `<br><span class="err">${esc(st.last_error)}</span>` : "");
  stopBtn.hidden = false;
  startBtn.disabled = true;
}

async function refreshSyncStatus() {
  renderSyncStatus(null);
  if (!state.syncSessionId) return;
  try {
    renderSyncStatus(await api.syncStatus(state.syncSessionId));
  } catch {
    state.syncSessionId = null; // session gone server-side
  }
}

$("form-sync").addEventListener("submit", async (e) => {
  e.preventDefault();
  const master = $("sync-master").value;
  const followers = [...$("sync-followers").querySelectorAll("input[type=checkbox]:checked")]
    .map(c => c.value);
  if (!master) { toast("Pick a master profile.", "error"); return; }
  if (followers.length === 0) { toast("Pick at least one follower.", "error"); return; }
  if (followers.includes(master)) { toast("Master cannot also be a follower.", "error"); return; }
  const payload = {
    master,
    followers,
    headless: $("sync-headless").value === "1",
    typing: $("sync-typing").value === "1",
  };
  try {
    const res = await api.syncStart(payload);
    state.syncSessionId = res.session_id;
    renderSyncStatus(res.status);
    toast(`Sync session started: ${master} → ${followers.length} follower(s).`, "success");
  } catch (err) {
    toast("Sync start failed: " + (err.message || err), "error");
  }
});

$("btn-sync-stop").addEventListener("click", async () => {
  if (!state.syncSessionId) return;
  try {
    await api.syncStop(state.syncSessionId);
    toast("Sync session stopped.", "success");
  } catch (err) {
    toast("Sync stop failed: " + (err.message || err), "error");
  }
  state.syncSessionId = null;
  renderSyncStatus(null);
});

$("sync-typing").addEventListener("change", async (e) => {
  if (!state.syncSessionId) return; // applies at start otherwise
  try {
    renderSyncStatus(await api.syncTyping(state.syncSessionId, e.target.value === "1"));
    toast("Typing mirror " + (e.target.value === "1" ? "enabled." : "disabled."), "success");
  } catch (err) {
    toast("Typing toggle failed: " + (err.message || err), "error");
  }
});

/* ---------------- Boot ---------------- */
(async function boot() {
  try { state.proxies = await api.listProxies(); } catch { /* non-fatal */ }
  await refreshProfiles();
})();
