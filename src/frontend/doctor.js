"use strict";

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port && window.location.port !== "5000"
  ? "http://localhost:5000"
  : "";

// ── Auth guard ─────────────────────────────────────────────────────────────
const _token = localStorage.getItem("cliniq_token");
const _role  = localStorage.getItem("cliniq_role");
if (!_token || _role !== "doctor") {
  window.location.href = "auth.html";
}

function authHeaders() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${_token}` };
}

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function show(id) { const el = typeof id === "string" ? $(id) : id; if (el) el.classList.remove("hidden"); }
function hide(id) { const el = typeof id === "string" ? $(id) : id; if (el) el.classList.add("hidden"); }
function esc(s)   { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function showToast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove("show"), 3500);
}

// ── Current open patient ───────────────────────────────────────────────────
let _currentPatientId = null;

// ── Bootstrap nav ──────────────────────────────────────────────────────────
function initNav() {
  const name = localStorage.getItem("cliniq_name") || "Doctor";
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  $("nav-avatar").textContent = initials;
  $("nav-user-name").textContent = name;
}

// ── Load patient list ──────────────────────────────────────────────────────
async function loadPatients() {
  try {
    const resp = await fetch(`${API_BASE}/api/doctor/patients`, { headers: authHeaders() });
    if (resp.status === 401) { logout(); return; }
    const data = await resp.json();
    if (!resp.ok) {
      $("error-banner").textContent = data.error || "Failed to load patients";
      show("error-banner"); return;
    }
    renderPatientList(data);
  } catch (e) {
    $("error-banner").textContent = "Cannot reach server. Is the backend running?";
    show("error-banner");
    $("patient-list").innerHTML = "";
  }
}

function renderPatientList(patients) {
  $("stat-patients").textContent    = patients.length;
  $("stat-polypharmacy").textContent = patients.filter(p => (p.med_count || 0) >= 5).length;
  // PGx stat: calculate patients with active PGx flags
  $("stat-pgx").textContent = patients.filter(p => p.has_pgx_flags || (p.pgx_count && p.pgx_count > 0)).length;
  $("patient-list-sub").textContent = `${patients.length} patient${patients.length !== 1 ? "s" : ""} registered`;

  const list = $("patient-list");
  if (!patients.length) {
    list.innerHTML = `<div class="card" style="padding:48px;text-align:center;color:var(--text-2);">No patients registered yet.</div>`;
    return;
  }

  list.innerHTML = "";
  for (const p of patients) {
    const initials = p.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
    const sexStr = p.sex ? p.sex.charAt(0).toUpperCase() + p.sex.slice(1).toLowerCase() : null;
    const metaStr  = [p.age ? `${p.age} yrs` : null, sexStr, p.weight_kg ? `${p.weight_kg} kg` : null]
      .filter(Boolean).join(" · ");

    const row = document.createElement("div");
    row.className = "patient-row";
    row.dataset.id = p.user_id;
    row.innerHTML = `
      <div class="patient-row-avatar">${initials}</div>
      <div class="patient-row-info">
        <div class="patient-row-name">${esc(p.name)}</div>
        <div class="patient-row-email">${esc(p.email)}</div>
        <span class="patient-row-meds">💊 ${p.med_count || 0} medication${p.med_count !== 1 ? "s" : ""}</span>
      </div>
      <div class="patient-row-meta">${esc(metaStr)}</div>
      <div class="patient-row-arrow">›</div>`;
    row.onclick = () => { window.location.href = "patient-view.html?id=" + encodeURIComponent(p.user_id); };
    list.appendChild(row);
  }
}

// ── Open patient detail ────────────────────────────────────────────────────
async function openPatient(patientId) {
  _currentPatientId = patientId;

  // Reset panel safely
  const setTxt  = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const setHtml = (id, val) => { const el = $(id); if (el) el.innerHTML   = val; };

  setTxt("detail-name", "Loading…");
  setTxt("detail-email", "");
  setHtml("detail-meds", "");
  setHtml("detail-comorb", "");
  setHtml("detail-pgx", "");
  setHtml("detail-demographics", "");

  hide("assess-results");
  hide("assess-error");
  hide("assess-spinner");
  const assessBtn = $("btn-run-assess");
  if (assessBtn) {
    assessBtn.disabled = false;
    assessBtn.textContent = "⚡ Run DDI Risk Assessment";
  }

  // Reset AI Co-Pilot card
  hide("ai-copilot-results");
  hide("ai-copilot-error");
  hide("ai-copilot-spinner");
  show("ai-copilot-placeholder");
  const copilotBtn = $("btn-run-ai-copilot");
  if (copilotBtn) {
    copilotBtn.disabled = false;
    copilotBtn.innerHTML = `<span>⚡ Run AI Assessment</span>`;
  }

  // Reset Rx Checker
  const rxInput = $("rx-drug-input"); if (rxInput) rxInput.value = "";
  hide("rx-result");
  hide("rx-spinner");
  const rxBtn = $("btn-rx-check"); if (rxBtn) rxBtn.disabled = false;

  show("detail-overlay");
  document.body.style.overflow = "hidden";

  try {
    const resp = await fetch(`${API_BASE}/api/doctor/patients/${patientId}`, { headers: authHeaders() });
    if (resp.status === 401) { logout(); return; }
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || "Could not load patient", "error"); closeDetailPanel(); return; }
    populateDetail(data);
  } catch (e) {
    showToast("Cannot reach server", "error");
    closeDetailPanel();
  }
}

function populateDetail(p) {
  $("detail-name").textContent  = p.name;
  $("detail-email").textContent = p.email;

  // Demographics
  const metaParts = [];
  if (p.age)       metaParts.push(`<span class="detail-pill">Age: ${p.age} yrs</span>`);
  if (p.sex) {
    const s = p.sex.charAt(0).toUpperCase() + p.sex.slice(1).toLowerCase();
    metaParts.push(`<span class="detail-pill">Sex: ${esc(s)}</span>`);
  }
  if (p.weight_kg) metaParts.push(`<span class="detail-pill">Weight: ${p.weight_kg} kg</span>`);
  
  if (metaParts.length) {
    $("detail-demographics").innerHTML = `
      <div class="detail-section-title">👤 Demographics</div>
      <div class="detail-meds">${metaParts.join("")}</div>`;
  } else {
    $("detail-demographics").innerHTML = `
      <div class="detail-section-title">👤 Demographics</div>
      <div class="detail-meds"><span style="color:var(--text-3);font-size:13px;">No demographic details recorded</span></div>`;
  }

  // Medications
  const medsEl = $("detail-meds");
  if (p.medications && p.medications.length) {
    medsEl.innerHTML = p.medications.map(m => `<span class="detail-pill">${esc(m)}</span>`).join("");
  } else {
    medsEl.innerHTML = `<span style="color:var(--text-3);font-size:13px;">No medications on record</span>`;
  }

  // Comorbidities
  const comorbEl = $("detail-comorb");
  if (p.comorbidities && p.comorbidities.length) {
    comorbEl.innerHTML = p.comorbidities.map(c =>
      `<span class="detail-pill comorb">${esc(c.replace(/_/g," "))}</span>`).join("");
  } else {
    comorbEl.innerHTML = `<span style="color:var(--text-3);font-size:13px;">None recorded</span>`;
  }

  // PGx
  const pgxEl  = $("detail-pgx");
  const profile = p.pgx_profile || {};
  const genes   = Object.entries(profile).filter(([,v]) => v && v !== "normal");
  if (genes.length) {
    pgxEl.innerHTML = `<div class="detail-meds">${genes.map(([g,v]) =>
      `<span class="detail-pgx-row"><span class="pgx-gene">${esc(g)}</span>
       <span class="detail-pill gene">${esc(v)} metaboliser</span></span>`).join("")}</div>`;
  } else {
    pgxEl.innerHTML = `<span style="color:var(--text-3);font-size:13px;">No PGx flags</span>`;
  }
}

// ── Run assessment ─────────────────────────────────────────────────────────
async function runAssessment() {
  if (!_currentPatientId) return;
  hide("assess-results");
  hide("assess-error");
  show("assess-spinner");
  $("btn-run-assess").disabled = true;
  $("btn-run-assess").textContent = "Assessing…";

  try {
    const resp = await fetch(`${API_BASE}/api/doctor/patients/${_currentPatientId}/assess`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!resp.ok) {
      $("assess-error").textContent = data.error || "Assessment failed.";
      show("assess-error"); return;
    }
    renderAssessment(data);
  } catch (e) {
    $("assess-error").textContent = "Cannot reach server.";
    show("assess-error");
  } finally {
    hide("assess-spinner");
    $("btn-run-assess").disabled = false;
    $("btn-run-assess").textContent = "⚡ Run DDI Risk Assessment";
  }
}

function renderAssessment(data) {
  // Score
  const scoreCard = $("assess-score-card");
  scoreCard.className = `score-card severity-${data.severity_band}`;
  $("assess-score-num").textContent  = data.total_score;
  $("assess-band-label").textContent = data.severity_band.toUpperCase();
  $("assess-score-sub").textContent  = `${data.interactions.length} interaction${data.interactions.length !== 1 ? "s" : ""} found`;

  // Table
  const tbody = $("assess-interactions-body");
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
  show("assess-results");

  // Auto-scroll the detail panel to the score card so the doctor sees results immediately
  const scoreEl = $("assess-score-card");
  if (scoreEl) {
    scoreEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ── Description truncation helpers ────────────────────────────────────────
function truncateDesc(text, maxLen = 80) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
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

// ── Clinical Insights Engine ────────────────────────────────────────────────
async function runAiCoPilot() {
  if (!_currentPatientId) return;
  hide("ai-copilot-results");
  hide("ai-copilot-error");
  hide("ai-copilot-placeholder");
  show("ai-copilot-spinner");
  const btn = $("btn-run-ai-copilot");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Analysing…</span>`;
  }

  try {
    const profileResp = await fetch(`${API_BASE}/api/doctor/patients/${_currentPatientId}`, { headers: authHeaders() });
    const profile = await profileResp.json();
    if (!profileResp.ok) throw new Error(profile.error || "Could not load patient profile");

    const resp = await fetch(`${API_BASE}/api/ai-assessment`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        patient_id:    _currentPatientId,
        medications:   profile.medications   || [],
        comorbidities: profile.comorbidities || [],
        pgx_profile:   profile.pgx_profile   || {},
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "AI Co-Pilot assessment failed");

    renderAiCoPilotResult(data);
    show("ai-copilot-results");
    $("ai-copilot-card").scrollIntoView({ behavior: "smooth", block: "nearest" });

  } catch (e) {
    $("ai-copilot-error").textContent = e.message;
    show("ai-copilot-error");
    show("ai-copilot-placeholder");
  } finally {
    hide("ai-copilot-spinner");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>⚡ Re-Run AI Assessment</span>`;
    }
  }
}

function renderAiCoPilotResult(data) {
  // Risk Summary
  $("ai-risk-summary-text").textContent = data.risk_summary || data.insight || "Clinical assessment complete.";

  // Risk Level Pill
  const pill = $("ai-risk-pill");
  const lvl = (data.risk_level || "MODERATE").toUpperCase();
  pill.textContent = `${lvl} RISK`;
  pill.className = `ai-risk-indicator ${(data.risk_level || "amber").toLowerCase()}`;

  // RED-flagged drugs & explicit safe alternatives
  const altList = $("ai-alternatives-list");
  const redFlags = data.red_flags || [];
  const safeAlts = data.safe_alternatives || [];

  if (redFlags.length === 0 && safeAlts.length === 0) {
    altList.innerHTML = `<div style="font-size:13px; color:#16a34a; padding:6px 0;">✅ No RED-flagged medications detected. All prescribed agents appear within standard therapeutic guidelines.</div>`;
  } else {
    let html = "";
    if (redFlags.length > 0) {
      html += redFlags.map(rf => `
        <div class="ai-alt-item">
          <span class="ai-alt-tag">${esc(rf.drug_display || rf.drug.toUpperCase())}</span>
          <div style="flex:1;">
            <div style="font-weight:600; color:#991b1b; margin-bottom:3px;">${esc(rf.reason)}</div>
            <div style="color:#0f52ba; font-size:12.5px; line-height:1.5;">💡 <strong>Safe Alternative:</strong> ${esc(rf.suggested_alternative)}</div>
          </div>
        </div>
      `).join("");
    } else if (safeAlts.length > 0) {
      html += safeAlts.map(alt => `
        <div class="ai-alt-item">
          <span class="ai-alt-tag">ALTERNATIVE</span>
          <div style="flex:1; color:#0f52ba; font-size:12.5px;">💡 ${esc(alt)}</div>
        </div>
      `).join("");
    }
    altList.innerHTML = html;
  }

  // Full IBM watsonx.ai Narrative
  $("ai-narrative-text").textContent = data.insight || "";

  // Metadata
  $("ai-model-label").textContent = data.model_id || "ibm/granite-13b-instruct-v2";
  $("ai-evaluated-time").textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toggleWatsonxDetails() {
  const body = $("ai-narrative-text");
  const arrow = $("ai-toggle-arrow");
  if (body.classList.contains("hidden")) {
    body.classList.remove("hidden");
    arrow.textContent = "▼";
  } else {
    body.classList.add("hidden");
    arrow.textContent = "▶";
  }
}

// Aliases for backward compatibility
const runInsights = runAiCoPilot;

function typeCls(t) {
  return { DDI:"type-ddi", Comorbidity:"type-comorbidity", PGx:"type-pgx" }[t] || "";
}

// ── Prescription Safety Checker ────────────────────────────────────────────
async function runRxCheck() {
  if (!_currentPatientId) return;
  const drugInput = $("rx-drug-input");
  const drugName  = drugInput.value.trim().toLowerCase();
  if (!drugName) { showToast("Enter a drug name first", "error"); return; }

  $("rx-result").classList.add("hidden");
  $("rx-spinner").classList.remove("hidden");
  $("btn-rx-check").disabled = true;

  try {
    const profileResp = await fetch(`${API_BASE}/api/doctor/patients/${_currentPatientId}`, { headers: authHeaders() });
    const profile = await profileResp.json();
    if (!profileResp.ok) throw new Error(profile.error || "Could not load patient");

    const resp = await fetch(`${API_BASE}/api/rx-check`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        drug:          drugName,
        medications:   profile.medications   || [],
        comorbidities: profile.comorbidities || [],
        pgx_profile:   profile.pgx_profile   || {},
        age:           profile.age,
        sex:           profile.sex,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Safety check failed");

    renderRxResult(data);
  } catch (e) {
    $("rx-result").innerHTML = `<div class="rx-verdict rx-verdict-warning"><span class="rx-verdict-icon">⚠</span> ${esc(e.message)}</div>`;
    $("rx-result").classList.remove("hidden");
  } finally {
    $("rx-spinner").classList.add("hidden");
    $("btn-rx-check").disabled = false;
  }
}

function renderRxResult(data) {
  const icons   = { safe: "✅", warning: "⚠️", contraindicated: "🚫" };
  const labels  = { safe: "Safe to Prescribe", warning: "Use with Caution", contraindicated: "Contraindicated" };
  const cls     = { safe: "rx-verdict-safe", warning: "rx-verdict-warning", contraindicated: "rx-verdict-danger" };
  const v = data.verdict;
  const resultEl = $("rx-result");
  resultEl.innerHTML = `
    <div class="rx-verdict ${cls[v] || ""}">
      <div class="rx-verdict-status">
        <span class="rx-verdict-icon">${icons[v] || "ℹ"}</span>
        <span class="rx-verdict-label">${labels[v] || v}</span>
        <span class="rx-verdict-drug">${esc(data.drug.toUpperCase())}</span>
      </div>
    </div>
    <pre class="rx-explanation">${esc(data.explanation)}</pre>`;
  resultEl.classList.remove("hidden");
  resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Close detail ───────────────────────────────────────────────────────────
function closeDetailPanel() {
  hide("detail-overlay");
  hide("desc-modal-overlay");
  document.body.style.overflow = "";
  _currentPatientId = null;
}

function closeDetail(event) {
  // Close if clicking the dark backdrop (not the panel itself)
  if (event.target === $("detail-overlay")) closeDetailPanel();
}

// ── Keyboard shortcut: Escape closes modal or panel ───────────────────────
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const descOverlay = $("desc-modal-overlay");
  if (descOverlay && !descOverlay.classList.contains("hidden")) {
    closeDescModal(); return;
  }
  closeDetailPanel();
});

// ── Enter key on Rx checker input ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const rxInput = $("rx-drug-input");
  if (rxInput) rxInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); runRxCheck(); }
  });
});

// ── Logout ─────────────────────────────────────────────────────────────────
function logout() {
  fetch(`${API_BASE}/api/auth/logout`, { method: "POST", headers: authHeaders() }).catch(() => {});
  localStorage.clear();
  window.location.href = "auth.html";
}

// ── Init ───────────────────────────────────────────────────────────────────
initNav();
loadPatients();
