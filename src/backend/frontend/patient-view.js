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
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove("show"), 3500);
}

// ── Get patient ID from query param ────────────────────────────────────────
const _urlParams = new URLSearchParams(window.location.search);
const _patientId = _urlParams.get("id");

if (!_patientId) {
  window.location.href = "doctor.html";
}

let _patientData = null;

// ── Init Nav ───────────────────────────────────────────────────────────────
function initNav() {
  const name = localStorage.getItem("cliniq_name") || "Doctor";
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  $("nav-avatar").textContent = initials;
  $("nav-user-name").textContent = name;
}

// ── Load Patient Profile ───────────────────────────────────────────────────
async function loadPatient() {
  try {
    const resp = await fetch(`${API_BASE}/api/doctor/patients/${_patientId}`, { headers: authHeaders() });
    if (resp.status === 401) { logout(); return; }
    const data = await resp.json();
    if (!resp.ok) {
      const errBanner = $("pv-error-banner");
      errBanner.textContent = data.error || "Could not load patient profile.";
      show(errBanner);
      return;
    }
    _patientData = data;
    renderPatientView(data);

    // Optionally auto-run assessment or AI co-pilot for immediate clinical speed
    // If the patient has medications, automatically trigger AI Co-Pilot for speed!
    if (data.medications && data.medications.length > 0) {
      runAiCoPilot();
    }
  } catch (e) {
    const errBanner = $("pv-error-banner");
    errBanner.textContent = "Cannot connect to server. Please verify backend is running.";
    show(errBanner);
  }
}

// ── Render Patient View ────────────────────────────────────────────────────
function renderPatientView(p) {
  // Hero section
  const initials = p.name ? p.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) : "PT";
  $("pv-avatar").textContent = initials;
  $("pv-name").textContent   = p.name;
  $("pv-id-badge").textContent = `MRN: #${p.user_id}`;
  $("pv-email").textContent  = p.email;
  document.title = `Clin.IQ — ${p.name}`;

  // Demographics pills
  const demoContainer = $("pv-demo-pills");
  const pills = [];
  if (p.age) pills.push(`<span class="pv-pill demo">🎂 Age: <strong>${p.age} yrs</strong></span>`);
  if (p.sex) {
    const s = p.sex.charAt(0).toUpperCase() + p.sex.slice(1).toLowerCase();
    pills.push(`<span class="pv-pill demo">👤 Sex: <strong>${esc(s)}</strong></span>`);
  }
  if (p.weight_kg) pills.push(`<span class="pv-pill demo">⚖️ Weight: <strong>${p.weight_kg} kg</strong></span>`);

  if (pills.length) {
    demoContainer.innerHTML = pills.join("");
  } else {
    demoContainer.innerHTML = `<span class="pv-pill demo" style="opacity:0.7;">No demographics recorded</span>`;
  }

  // Active Medications
  const medsList = $("pv-meds-list");
  const medCount = p.medications ? p.medications.length : 0;
  $("pv-meds-count").textContent = `${medCount} prescribed`;
  if (medCount > 0) {
    medsList.innerHTML = p.medications.map(m => `
      <span class="pv-pill med">
        <span class="pv-pill-bullet">💊</span>
        <strong style="text-transform: capitalize;">${esc(m)}</strong>
      </span>
    `).join("");
  } else {
    medsList.innerHTML = `<span class="pv-empty-text">No medications on active record</span>`;
  }

  // Comorbidities
  const comorbList = $("pv-comorb-list");
  const comorbCount = p.comorbidities ? p.comorbidities.length : 0;
  $("pv-comorb-count").textContent = `${comorbCount} condition${comorbCount !== 1 ? "s" : ""}`;
  if (comorbCount > 0) {
    comorbList.innerHTML = p.comorbidities.map(c => `
      <span class="pv-pill comorb">
        <span class="pv-pill-bullet">⚠️</span>
        <strong>${esc(c.replace(/_/g, " "))}</strong>
      </span>
    `).join("");
  } else {
    comorbList.innerHTML = `<span class="pv-empty-text">No chronic comorbidities documented</span>`;
  }

  // Pharmacogenomics (PGx)
  const pgxList = $("pv-pgx-list");
  const profile = p.pgx_profile || {};
  const genes   = Object.entries(profile).filter(([,v]) => v && v !== "normal");
  $("pv-pgx-count").textContent = `${genes.length} variant${genes.length !== 1 ? "s" : ""}`;

  if (genes.length) {
    pgxList.innerHTML = genes.map(([g, v]) => `
      <div class="pv-pgx-card">
        <div class="pv-pgx-gene">${esc(g)}</div>
        <div class="pv-pgx-status">${esc(v)} metaboliser</div>
      </div>
    `).join("");
  } else {
    pgxList.innerHTML = `<span class="pv-empty-text">Standard metaboliser profile across known alleles</span>`;
  }
}

// ── Run AI Clinical Co-Pilot ───────────────────────────────────────────────
async function runAiCoPilot() {
  if (!_patientData) return;

  hide("ai-copilot-results");
  hide("ai-copilot-error");
  hide("ai-copilot-placeholder");
  show("ai-copilot-spinner");

  const btnTop  = $("btn-pv-run-ai");
  const btnCard = $("btn-run-ai-copilot");
  if (btnTop)  btnTop.disabled = true;
  if (btnCard) {
    btnCard.disabled = true;
    btnCard.innerHTML = `<span>Analysing…</span>`;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/ai-assessment`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        patient_id:    _patientData.user_id,
        medications:   _patientData.medications   || [],
        comorbidities: _patientData.comorbidities || [],
        pgx_profile:   _patientData.pgx_profile   || {},
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "AI Co-Pilot assessment failed");

    renderAiCoPilotResult(data);
    show("ai-copilot-results");

  } catch (e) {
    const errEl = $("ai-copilot-error");
    errEl.textContent = e.message;
    show(errEl);
    show("ai-copilot-placeholder");
  } finally {
    hide("ai-copilot-spinner");
    if (btnTop)  btnTop.disabled = false;
    if (btnCard) {
      btnCard.disabled = false;
      btnCard.innerHTML = `<span>⚡ Re-Run AI Assessment</span>`;
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
  pill.className = `ai-risk-indicator pv-large-risk-pill ${(data.risk_level || "amber").toLowerCase()}`;

  // RED-flagged drugs & explicit safe alternatives
  const altList = $("ai-alternatives-list");
  const redFlags = data.red_flags || [];
  const safeAlts = data.safe_alternatives || [];

  if (redFlags.length === 0 && safeAlts.length === 0) {
    altList.innerHTML = `<div style="font-size:14.5px; color:#16a34a; font-weight:600; padding:10px 0;">✅ No RED-flagged medications detected. All prescribed agents appear within standard therapeutic guidelines.</div>`;
  } else {
    let html = "";
    if (redFlags.length > 0) {
      html += redFlags.map(rf => `
        <div class="pv-alt-item">
          <span class="pv-alt-tag">${esc(rf.drug_display || rf.drug.toUpperCase())}</span>
          <div style="flex:1;">
            <div style="font-weight:700; color:#991b1b; font-size:15px; margin-bottom:4px;">${esc(rf.reason)}</div>
            <div class="pv-alt-switch">
              <span class="pv-alt-switch-icon">💡</span>
              <div><strong>Safe Alternative:</strong> ${esc(rf.suggested_alternative)}</div>
            </div>
          </div>
        </div>
      `).join("");
    } else if (safeAlts.length > 0) {
      html += safeAlts.map(alt => `
        <div class="pv-alt-item">
          <span class="pv-alt-tag">ALTERNATIVE</span>
          <div style="flex:1; color:#0f52ba; font-size:14.5px;">💡 ${esc(alt)}</div>
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

// ── Run DDI Risk Assessment ────────────────────────────────────────────────
async function runAssessment() {
  if (!_patientId) return;

  hide("assess-results");
  hide("assess-placeholder");
  hide("assess-error");
  show("assess-spinner");

  const btnTop  = $("btn-pv-run-assess");
  const btnCard = $("btn-run-assess");
  if (btnTop)  btnTop.disabled = true;
  if (btnCard) {
    btnCard.disabled = true;
    btnCard.textContent = "Assessing…";
  }

  try {
    const resp = await fetch(`${API_BASE}/api/doctor/patients/${_patientId}/assess`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!resp.ok) {
      $("assess-error").textContent = data.error || "Assessment failed.";
      show("assess-error");
      show("assess-placeholder");
      return;
    }
    renderAssessment(data);
  } catch (e) {
    $("assess-error").textContent = "Cannot reach server.";
    show("assess-error");
    show("assess-placeholder");
  } finally {
    hide("assess-spinner");
    if (btnTop)  btnTop.disabled = false;
    if (btnCard) {
      btnCard.disabled = false;
      btnCard.textContent = "⚡ Re-Run Assessment";
    }
  }
}

function renderAssessment(data) {
  // Score
  const scoreCard = $("assess-score-card");
  scoreCard.className = `score-card pv-score-card severity-${data.severity_band}`;
  $("assess-score-num").textContent  = data.total_score;
  $("assess-band-label").textContent = `${data.severity_band.toUpperCase()} SEVERITY`;
  $("assess-score-sub").textContent  = `${data.interactions.length} interaction${data.interactions.length !== 1 ? "s" : ""} detected across pharmacological regimen`;
  $("pv-table-count").textContent    = `${data.interactions.length} items`;

  // Table
  const tbody = $("assess-interactions-body");
  tbody.innerHTML = "";
  for (const item of data.interactions) {
    const tr = document.createElement("tr");
    const shortDesc = truncateDesc(item.description, 95);
    const needsMore = item.description.length > shortDesc.length;
    tr.innerHTML = `
      <td style="font-weight:700; color:var(--text-3); font-size:14px;">${item.rank}</td>
      <td><span class="type-badge ${typeCls(item.type)}">${esc(item.type)}</span></td>
      <td><strong style="color:var(--text); font-size:14.5px;">${esc(item.drug_a)}</strong></td>
      <td style="font-size:14.5px;">${esc(item.drug_b)}</td>
      <td><strong style="font-size:15px; color:var(--brand-dark);">${item.score_contribution}</strong></td>
      <td><span class="badge badge-${item.severity_band}" style="font-size:12px; padding:4px 10px;">${item.severity_band}</span></td>
      <td class="td-desc" style="max-width:320px; font-size:13.5px; line-height:1.55;">
        <span class="desc-short">${esc(shortDesc)}</span>
        ${needsMore ? `<button class="btn-see-more" onclick="openDescModal(this)" data-full="${esc(item.description)}" data-pair="${esc(item.drug_a)} + ${esc(item.drug_b)}">See full details</button>` : ""}
      </td>`;
    tbody.appendChild(tr);
  }
  show("assess-results");
}

function typeCls(t) {
  return { DDI: "type-ddi", Comorbidity: "type-comorbidity", PGx: "type-pgx" }[t] || "";
}

function truncateDesc(text, maxLen = 95) {
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

// ── Prescription Safety Checker ────────────────────────────────────────────
async function runRxCheck() {
  if (!_patientData) return;
  const drugInput = $("rx-drug-input");
  const drugName  = drugInput.value.trim().toLowerCase();
  if (!drugName) { showToast("Enter a drug name first", "error"); return; }

  $("rx-result").classList.add("hidden");
  $("rx-spinner").classList.remove("hidden");
  $("btn-rx-check").disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/api/rx-check`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        drug:          drugName,
        medications:   _patientData.medications   || [],
        comorbidities: _patientData.comorbidities || [],
        pgx_profile:   _patientData.pgx_profile   || {},
        age:           _patientData.age,
        sex:           _patientData.sex,
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
    <div class="rx-verdict ${cls[v] || ""}" style="padding:14px 18px;">
      <div class="rx-verdict-status">
        <span class="rx-verdict-icon" style="font-size:24px;">${icons[v] || "ℹ"}</span>
        <span class="rx-verdict-label" style="font-size:16px; font-weight:800;">${labels[v] || v}</span>
        <span class="rx-verdict-drug" style="font-size:15px;">${esc(data.drug.toUpperCase())}</span>
      </div>
    </div>
    <pre class="rx-explanation" style="font-size:13.5px; line-height:1.65; max-height:260px;">${esc(data.explanation)}</pre>`;
  resultEl.classList.remove("hidden");
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDescModal();
});

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

// ── Bootstrap ──────────────────────────────────────────────────────────────
initNav();
loadPatient();
