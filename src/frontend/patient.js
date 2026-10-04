"use strict";

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port && window.location.port !== "5000"
  ? "http://localhost:5000"
  : "";

// ── Auth guard ─────────────────────────────────────────────────────────────
const _token = localStorage.getItem("cliniq_token");
const _role  = localStorage.getItem("cliniq_role");
if (!_token || _role !== "patient") {
  window.location.href = "auth.html";
}

function authHeaders() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${_token}` };
}

// ── Static data ────────────────────────────────────────────────────────────
const KNOWN_COMORBIDITIES = [
  { key: "renal_impairment",    label: "Renal Impairment" },
  { key: "hepatic_impairment",  label: "Hepatic Impairment" },
  { key: "heart_failure",       label: "Heart Failure" },
  { key: "diabetes",            label: "Diabetes" },
  { key: "hypertension",        label: "Hypertension" },
  { key: "atrial_fibrillation", label: "Atrial Fibrillation" },
];

const KNOWN_GENES = ["CYP2D6","CYP2C19","CYP2C9","SLCO1B1","TPMT","DPYD"];
const PGX_STATUSES = ["normal","intermediate","poor"];

let medications = [];

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function esc(s)   { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function showToast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ── Build static controls ──────────────────────────────────────────────────
function buildControls() {
  const cg = $("comorbidity-group");
  cg.innerHTML = "";
  for (const c of KNOWN_COMORBIDITIES) {
    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";
    lbl.innerHTML = `<input type="checkbox" id="cb-${c.key}" value="${c.key}" />${c.label}`;
    cg.appendChild(lbl);
  }

  const pg = $("pgx-group");
  pg.innerHTML = "";
  for (const gene of KNOWN_GENES) {
    const row = document.createElement("div");
    row.className = "pgx-row";
    row.innerHTML = `
      <span class="pgx-gene">${gene}</span>
      <select class="pgx-select" id="pgx-${gene}" data-gene="${gene}">
        ${PGX_STATUSES.map(s => `<option value="${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join("")}
      </select>`;
    pg.appendChild(row);
  }
}

// ── Render medication tags ─────────────────────────────────────────────────
function renderMeds() {
  const list = $("med-list");
  list.innerHTML = "";
  for (const drug of medications) {
    const li = document.createElement("li");
    li.className = "tag";
    li.innerHTML = `${esc(drug)}<button class="tag-remove" data-drug="${esc(drug)}" title="Remove">×</button>`;
    list.appendChild(li);
  }
  list.querySelectorAll(".tag-remove").forEach(btn => {
    btn.onclick = () => { medications = medications.filter(m => m !== btn.dataset.drug); renderMeds(); updateCounters(); };
  });
  updateCounters();
}

function addMedication() {
  const input = $("med-input");
  const val = input.value.trim().toLowerCase();
  if (!val) return;
  if (!medications.includes(val)) { medications.push(val); renderMeds(); }
  input.value = "";
  input.focus();
}

// ── Update profile header counters ────────────────────────────────────────
function updateCounters() {
  $("profile-med-count").textContent = medications.length;
  const comorbs = KNOWN_COMORBIDITIES.filter(c => $(`cb-${c.key}`)?.checked).length;
  $("profile-comorb-count").textContent = comorbs;
  const pgxFlags = KNOWN_GENES.filter(g => { const s = $(`pgx-${g}`); return s && s.value !== "normal"; }).length;
  $("profile-pgx-count").textContent = pgxFlags;
}

// ── Load profile from API ──────────────────────────────────────────────────
async function loadProfile() {
  try {
    const resp = await fetch(`${API_BASE}/api/patient/profile`, { headers: authHeaders() });
    if (resp.status === 401) { logout(); return; }
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || "Failed to load profile", "error"); return; }
    populateForm(data);
  } catch (e) {
    showToast("Cannot reach server", "error");
  }
}

function populateForm(data) {
  // Nav + profile card
  const name = localStorage.getItem("cliniq_name") || data.name || "You";
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  $("nav-avatar").textContent = initials;
  $("nav-user-name").textContent = name;
  $("profile-avatar").textContent = initials;
  $("profile-name").textContent = name;
  $("profile-email").textContent = data.email || "";

  // Meta — assign unconditionally so input reflects saved value even on reload
  $("meta-age").value    = data.age       ?? "";
  const rawSex = data.sex || "";
  $("meta-sex").value    = rawSex ? rawSex.charAt(0).toUpperCase() + rawSex.slice(1).toLowerCase() : "";
  $("meta-weight").value = data.weight_kg ?? "";

  // Medications
  medications = (data.medications || []).map(m => m.toLowerCase());
  renderMeds();

  // Comorbidities
  const active = new Set((data.comorbidities || []).map(c => c.toLowerCase()));
  for (const c of KNOWN_COMORBIDITIES) {
    const cb = $(`cb-${c.key}`);
    if (cb) cb.checked = active.has(c.key);
  }

  // PGx
  const profile = data.pgx_profile || {};
  for (const gene of KNOWN_GENES) {
    const sel = $(`pgx-${gene}`);
    if (!sel) continue;
    const status = (profile[gene] || "normal").toLowerCase();
    sel.value = PGX_STATUSES.includes(status) ? status : "normal";
  }

  updateCounters();
  $("save-status").textContent = "Profile loaded";
  $("save-status").classList.add("saved");
}

// ── Collect form state ─────────────────────────────────────────────────────
function collectForm() {
  const comorbidities = KNOWN_COMORBIDITIES
    .filter(c => $(`cb-${c.key}`)?.checked)
    .map(c => c.key);

  const pgx_profile = {};
  for (const gene of KNOWN_GENES) {
    const sel = $(`pgx-${gene}`);
    if (sel && sel.value !== "normal") pgx_profile[gene] = sel.value;
  }

  const sexInput = ($("meta-sex").value || "").trim();
  return {
    age:          parseInt($("meta-age").value) || null,
    sex:          sexInput ? sexInput.toLowerCase() : null,
    weight_kg:    parseFloat($("meta-weight").value) || null,
    medications:  [...medications],
    comorbidities,
    pgx_profile,
  };
}

// ── Save profile ───────────────────────────────────────────────────────────
async function saveProfile() {
  const payload = collectForm();
  try {
    const resp = await fetch(`${API_BASE}/api/patient/profile`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || "Save failed", "error"); return; }
    showToast("Profile saved ✓");
    $("save-status").textContent = "Profile saved";
    $("save-status").classList.add("saved");
  } catch (e) {
    showToast("Cannot reach server", "error");
  }
}

// ── Assess risk ────────────────────────────────────────────────────────────
async function assessRisk() {
  const payload = collectForm();
  if (!payload.medications.length) {
    showToast("Add at least one medication first", "error"); return;
  }

  hide("empty-state");
  hide("card-score");
  hide("card-interactions");
  hide("error-banner");
  show("spinner");

  try {
    const resp = await fetch(`${API_BASE}/api/assess`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      $("error-banner").textContent = data.error || "Assessment failed";
      show("error-banner"); return;
    }
    renderResults(data);
  } catch (e) {
    $("error-banner").textContent = "Cannot reach server";
    show("error-banner");
  } finally {
    hide("spinner");
  }
}

function renderResults(data) {
  // Score card
  const scoreCard  = $("card-score");
  const ring       = $("score-ring");
  const bandLabel  = $("score-band-label");
  const sub        = $("score-sub");
  const num        = $("score-number");

  num.textContent       = data.total_score;
  bandLabel.textContent = data.severity_band.toUpperCase();
  sub.textContent       = `${data.interactions.length} interactions found`;

  scoreCard.className = `score-card severity-${data.severity_band}`;
  ring.style.borderColor = "";
  show("card-score");

  // Table
  const tbody = $("interactions-body");
  tbody.innerHTML = "";
  for (const item of data.interactions) {
    const tr = document.createElement("tr");
    const shortDesc = truncateDesc(item.description);
    const needsMore = item.description.length > shortDesc.length;
    tr.innerHTML = `
      <td>${item.rank}</td>
      <td><span class="type-badge ${typeCls(item.type)}">${esc(item.type)}</span></td>
      <td><strong>${esc(item.drug_a)}</strong></td>
      <td>${esc(item.drug_b)}</td>
      <td><strong>${item.score_contribution}</strong></td>
      <td><span class="badge badge-${item.severity_band}">${item.severity_band}</span></td>
      <td class="td-desc">
        <span class="desc-short">${esc(shortDesc)}</span>
        ${needsMore ? `<button class="btn-see-more" onclick="openDescModal(this)" data-full="${esc(item.description)}" data-pair="${esc(item.drug_a)} + ${esc(item.drug_b)}">See more</button>` : ""}
      </td>`;
    tbody.appendChild(tr);
  }
  show("card-interactions");
}

// ── Description truncation helpers ────────────────────────────────────────
function truncateDesc(text, maxLen = 80) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  // Break at last word boundary before maxLen
  const cut = text.lastIndexOf(" ", maxLen);
  return text.slice(0, cut > 20 ? cut : maxLen) + "…";
}

function openDescModal(btn) {
  const full = btn.dataset.full;
  const pair = btn.dataset.pair;
  $("desc-modal-title").textContent = pair;
  $("desc-modal-body").textContent  = full;
  show("desc-modal-overlay");
  document.body.style.overflow = "hidden";
}

function closeDescModal() {
  hide("desc-modal-overlay");
  document.body.style.overflow = "";
}

function typeCls(t) {
  return { DDI: "type-ddi", Comorbidity: "type-comorbidity", PGx: "type-pgx" }[t] || "";
}

// ── Logout ─────────────────────────────────────────────────────────────────
function logout() {
  fetch(`${API_BASE}/api/auth/logout`, { method: "POST", headers: authHeaders() }).catch(() => {});
  localStorage.clear();
  window.location.href = "auth.html";
}

// ── Init ───────────────────────────────────────────────────────────────────
buildControls();
loadProfile();

$("med-input").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addMedication(); }
});

// Mark unsaved on any change
["meta-age","meta-sex","meta-weight"].forEach(id => {
  $(id).addEventListener("change", () => {
    $("save-status").textContent = "Unsaved changes";
    $("save-status").classList.remove("saved");
  });
});
$("comorbidity-group").addEventListener("change", () => {
  $("save-status").textContent = "Unsaved changes";
  $("save-status").classList.remove("saved");
  updateCounters();
});
$("pgx-group").addEventListener("change", () => {
  $("save-status").textContent = "Unsaved changes";
  $("save-status").classList.remove("saved");
  updateCounters();
});
