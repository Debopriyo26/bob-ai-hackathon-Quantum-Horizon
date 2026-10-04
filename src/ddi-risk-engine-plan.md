# DDI Risk Engine — Full-Stack Architecture Plan

## Top-Level Overview

**Goal:** Build a hackathon-ready, full-stack web application that helps clinicians instantly evaluate the risk of adverse drug-drug interactions (DDIs) for polypharmacy patients (5+ medications). The tool integrates three clinical dimensions — DDI data, comorbidities, and pharmacogenomics — and returns a single ranked, colour-coded risk picture at the point of prescribing.

**Scope:**
- Python (Flask) REST backend with three analysis modules
- Plain HTML/CSS/JS single-page clinician dashboard
- OpenFDA API as the live DDI data source
- Static CPIC pharmacogenomics lookup table (JSON)
- Static patient profile (JSON) with UI override capability
- No authentication, no database — demo-grade persistence only

**Non-Goals:**
- User login / session management
- EHR integration
- Real patient record storage
- FHIR compliance

---

## Architecture Diagram (described in text)

```
Browser (HTML/CSS/JS)
        |
        |  HTTP POST /api/assess  (JSON)
        v
Flask REST API  (app.py)
        |
   +----|----+----------+
   |         |          |
DDI Module  Comorbidity  PGx Module
OpenFDA API  Module      CPIC JSON
             Static JSON  Lookup
        |
   Risk Scorer  (scorer.py)
        |
   JSON Response → Dashboard renders ranked risk list
```

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Plain HTML5 + CSS3 + Vanilla JS | No build toolchain needed; fast to iterate |
| Backend | Python 3.11 + Flask | Lightweight, easy to demo, rich ecosystem |
| DDI Data | OpenFDA Drug Interaction API | Free, no key required, covers FDA-labelled interactions |
| PGx Data | CPIC static JSON lookup | Offline-capable; covers most clinically actionable gene-drug pairs |
| Comorbidity Data | Static JSON patient profile | Sufficient for demo; overridable via UI |
| HTTP Client | Python `requests` library | Standard; handles OpenFDA calls |
| CORS | `flask-cors` | Allows the static frontend to call the API |
| Styling | CSS custom properties + flexbox/grid | No dependency; responsive enough for a demo |

---

## Data Flow (end-to-end)

1. Clinician opens `index.html` in a browser.
2. Dashboard pre-populates the medication list, comorbidities, and gene-sensitivity profile from the static patient profile JSON (fetched via `GET /api/patient/demo`).
3. Clinician can add/remove drugs and toggle comorbidities and gene sensitivities.
4. Clinician clicks **Assess Risk**.
5. Browser POSTs `{ medications: [...], comorbidities: [...], pgx_profile: {...} }` to `POST /api/assess`.
6. Flask backend runs three parallel analysis modules:
   - **DDI Module** — calls OpenFDA for every drug pair, returns raw interaction severity labels.
   - **Comorbidity Module** — cross-references each drug against the patient's active conditions using a local risk-weight table.
   - **PGx Module** — looks up each drug in the CPIC JSON and applies a risk multiplier if the patient carries a relevant gene variant.
7. **Risk Scorer** aggregates the three module outputs into a single score (0–100) and a ranked list of drug-pair interactions, each with a severity band (green/amber/red).
8. Flask returns `{ total_score, severity_band, interactions: [ranked list] }` as JSON.
9. Dashboard renders the score gauge, colour band, and the ranked interaction table.

---

## Project File Structure

```
quantum-horizon/
├── backend/
│   ├── app.py                  # Flask entry point, route definitions
│   ├── modules/
│   │   ├── ddi.py              # OpenFDA API calls, interaction label parsing
│   │   ├── comorbidity.py      # Comorbidity × drug risk-weight lookup
│   │   └── pgx.py              # CPIC JSON lookup, gene-drug multiplier
│   ├── scorer.py               # Aggregates module outputs → 0-100 score
│   ├── data/
│   │   ├── cpic_lookup.json    # Static CPIC gene-drug sensitivity table
│   │   ├── comorbidity_weights.json  # Condition × drug risk weights
│   │   └── patient_demo.json   # Default demo patient profile
│   └── requirements.txt        # flask, flask-cors, requests
└── frontend/
    ├── index.html              # Single-page clinician dashboard
    ├── style.css               # Colour system, layout, severity bands
    └── app.js                  # API calls, DOM rendering, form logic
```

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffold & Backend Entry Point

**Status:** [x] done

**Intent:**
Create the directory structure, `requirements.txt`, and the Flask `app.py` skeleton with route stubs. This establishes the foundation all other sub-tasks build on.

**Expected Outcomes:**
- `backend/` and `frontend/` directories exist.
- `requirements.txt` lists `flask`, `flask-cors`, `requests`.
- `app.py` has two route stubs: `GET /api/patient/demo` and `POST /api/assess` (both returning placeholder JSON).
- `flask run` starts without errors.

**Todo List:**
1. Create `backend/` and `frontend/` directories.
2. Write `backend/requirements.txt` with `flask`, `flask-cors`, `requests`.
3. Write `backend/app.py` with Flask app init, CORS enabled, and the two route stubs.
4. Create empty `backend/modules/` directory with a `__init__.py`.
5. Confirm the server starts cleanly.

**Relevant Context:**
- No existing code — greenfield.
- CORS must be enabled globally so the static `index.html` (served from the filesystem or a different port) can reach the API.

---

### Sub-Task 2 — Static Data Files

**Status:** [x] done

**Intent:**
Populate the three JSON data files that drive the comorbidity and PGx modules, plus the demo patient profile. These are the offline knowledge base for the engine.

**Expected Outcomes:**
- `data/cpic_lookup.json` — covers at least 15 clinically significant gene-drug pairs (e.g. CYP2D6/codeine, CYP2C19/clopidogrel, TPMT/azathioprine).
- `data/comorbidity_weights.json` — maps condition names (e.g. `renal_impairment`, `hepatic_impairment`, `heart_failure`) to a risk-weight multiplier per drug class or specific drug.
- `data/patient_demo.json` — a realistic demo patient: 5+ medications, 2–3 comorbidities, 1–2 gene sensitivities.

**Todo List:**
1. Research and write `cpic_lookup.json` with gene, drug, interaction type, and severity fields.
2. Write `comorbidity_weights.json` with condition-drug risk multipliers.
3. Write `patient_demo.json` with `medications`, `comorbidities`, and `pgx_profile` keys.

**Relevant Context:**
- CPIC guidelines: https://cpicpgx.org/genes-drugs/
- Comorbidities most relevant to polypharmacy: renal impairment (affects drug clearance), hepatic impairment (affects metabolism), heart failure, diabetes.
- The demo patient should be realistic enough to trigger at least one amber and one red interaction for demo impact.

---

### Sub-Task 3 — DDI Module (OpenFDA Integration)

**Status:** [x] done

**Intent:**
Implement `backend/modules/ddi.py` which takes a list of drug names, queries the OpenFDA drug interaction endpoint for every pair, and returns a structured list of interaction objects with severity labels parsed from FDA label text.

**Expected Outcomes:**
- `get_ddi_interactions(medications: list[str]) -> list[dict]` function is implemented.
- Each returned dict has keys: `drug_a`, `drug_b`, `description`, `raw_severity` (parsed from FDA label keywords).
- The module handles API errors and missing interactions gracefully (returns empty list for a pair if not found).
- At least one real interaction is returned for the demo patient's drug list.

**Todo List:**
1. Write `ddi.py` with a `get_ddi_interactions(medications)` function.
2. Implement pair enumeration (all unique 2-combinations of the medication list).
3. For each pair, call `https://api.fda.gov/drug/label.json?search=drug_interactions:"<drug_a>"+"<drug_b>"&limit=1`.
4. Parse the `drug_interactions` field from the response to extract a severity signal (keywords: "contraindicated", "avoid", "serious", "caution", "monitor").
5. Map keywords to a numeric severity score: `contraindicated=10`, `avoid=8`, `serious=6`, `caution=4`, `monitor=2`, `unknown=1`.
6. Return a list of interaction dicts.

**Relevant Context:**
- OpenFDA endpoint: `https://api.fda.gov/drug/label.json`
- No API key required for public rate limits (up to 1000 requests/day unauthenticated).
- For a list of 6 drugs, there are 15 pairs — all can be checked in one assessment.

---

### Sub-Task 4 — Comorbidity Module

**Status:** [x] done

**Intent:**
Implement `backend/modules/comorbidity.py` which cross-references each drug in the patient's medication list against their active comorbidities using the `comorbidity_weights.json` lookup, returning per-drug risk contributions.

**Expected Outcomes:**
- `get_comorbidity_risks(medications: list[str], comorbidities: list[str]) -> list[dict]` is implemented.
- Returns a list of dicts: `{ drug, condition, risk_weight }` for every matched drug-condition pair.
- Unmatched drug-condition pairs are silently skipped.

**Todo List:**
1. Write `comorbidity.py` with a `get_comorbidity_risks(medications, comorbidities)` function.
2. Load `comorbidity_weights.json` at module import time.
3. For each drug, look up each active comorbidity and return the risk weight.
4. Normalise drug names to lowercase for matching.

**Relevant Context:**
- Data file: `backend/data/comorbidity_weights.json` (created in Sub-Task 2).
- Risk weights are additive — a drug flagged by two comorbidities accumulates both weights.

---

### Sub-Task 5 — Pharmacogenomics (PGx) Module

**Status:** [x] done

**Intent:**
Implement `backend/modules/pgx.py` which looks up each drug in `cpic_lookup.json` and checks whether the patient's gene-sensitivity profile triggers an elevated risk multiplier.

**Expected Outcomes:**
- `get_pgx_risks(medications: list[str], pgx_profile: dict) -> list[dict]` is implemented.
- Returns a list of dicts: `{ drug, gene, variant, recommendation, multiplier }`.
- Only entries where the patient carries the relevant gene variant are returned.

**Todo List:**
1. Write `pgx.py` with a `get_pgx_risks(medications, pgx_profile)` function.
2. Load `cpic_lookup.json` at module import time.
3. For each drug, check if it appears in the CPIC lookup.
4. If the lookup entry's gene is present in `pgx_profile` with a matching variant (poor/intermediate metaboliser), return the risk entry.
5. Assign a multiplier: poor metaboliser = 2.0, intermediate = 1.5, normal = 1.0 (skip).

**Relevant Context:**
- Data file: `backend/data/cpic_lookup.json` (created in Sub-Task 2).
- `pgx_profile` format: `{ "CYP2D6": "poor", "CYP2C19": "intermediate" }`.

---

### Sub-Task 6 — Risk Scorer

**Status:** [x] done

**Intent:**
Implement `backend/scorer.py` which aggregates the outputs of all three modules into a single 0–100 aggregate score and a ranked list of interactions with severity bands.

**Expected Outcomes:**
- `compute_risk(ddi_results, comorbidity_results, pgx_results) -> dict` is implemented.
- Returns `{ total_score (0-100), severity_band ("green"/"amber"/"red"), interactions: [ranked list] }`.
- Each item in `interactions` has: `drug_a`, `drug_b` (or drug + condition/gene), `description`, `score_contribution`, `severity_band`.
- Items are sorted by `score_contribution` descending.

**Todo List:**
1. Write `scorer.py` with a `compute_risk(ddi_results, comorbidity_results, pgx_results)` function.
2. Convert all module outputs into a unified list of scored interaction items.
3. Apply PGx multipliers to DDI scores where the same drug appears in both lists.
4. Apply comorbidity weights as additive score contributions.
5. Sum all contributions, cap at 100, and assign severity band: 0–33 green, 34–66 amber, 67–100 red.
6. Sort the unified interaction list by score contribution descending.
7. Return the final response dict.

**Relevant Context:**
- Scoring formula: `total_score = min(100, sum_of_all_contributions)`.
- DDI base score for a pair: `ddi_severity_numeric * pgx_multiplier_for_drug_a_or_b`.
- Comorbidity contribution: `risk_weight` directly added to total.

---

### Sub-Task 7 — Flask API Routes

**Status:** [x] done

**Intent:**
Wire up the two Flask routes in `app.py` to call the three modules and scorer, returning structured JSON responses.

**Expected Outcomes:**
- `GET /api/patient/demo` returns the contents of `patient_demo.json`.
- `POST /api/assess` accepts `{ medications, comorbidities, pgx_profile }`, calls all three modules + scorer, and returns the full risk result JSON.
- Both routes return proper HTTP status codes and `Content-Type: application/json`.

**Todo List:**
1. Import all three modules and `scorer` into `app.py`.
2. Implement `GET /api/patient/demo` to read and return `patient_demo.json`.
3. Implement `POST /api/assess` to parse the request body, call modules, call scorer, and return the result.
4. Add basic input validation (return 400 if `medications` is missing or empty).

**Relevant Context:**
- Route stubs created in Sub-Task 1.
- All module functions defined in Sub-Tasks 3–5; scorer defined in Sub-Task 6.

---

### Sub-Task 8 — Frontend Dashboard

**Status:** [x] done

**Intent:**
Build the single-page clinician dashboard in plain HTML/CSS/JS. It pre-loads the demo patient profile, allows medication/comorbidity/PGx overrides, triggers the assessment, and renders the risk score and ranked interaction list.

**Expected Outcomes:**
- `index.html` renders a clean, professional clinician UI.
- Medication list, comorbidity checkboxes, and PGx gene-variant selectors are pre-populated from `GET /api/patient/demo`.
- Clicking "Assess Risk" POSTs to `POST /api/assess` and displays results without a page reload.
- The risk score is shown as a large number with a colour-coded background (green/amber/red).
- The interaction list is shown as a sortable table with severity badges.
- All layout is responsive enough for a laptop screen demo.

**Todo List:**
1. Write `frontend/index.html` with sections: Patient Profile panel, Medication list, Comorbidities panel, PGx Profile panel, and Results panel.
2. Write `frontend/style.css` with colour variables for green/amber/red severity bands, card layout, and table styles.
3. Write `frontend/app.js` with:
   - `loadDemoPatient()` — calls `GET /api/patient/demo` and populates the form fields.
   - `assessRisk()` — collects form state, POSTs to `/api/assess`, calls `renderResults()`.
   - `renderResults(data)` — updates the score display, applies colour band CSS class, and builds the interaction table rows.
4. Add a loading spinner while the API call is in flight.
5. Handle API errors with a user-visible error message.

**Relevant Context:**
- Backend API base URL should be configurable via a JS constant (e.g. `const API_BASE = "http://localhost:5000"`).
- Severity band CSS classes: `.severity-green`, `.severity-amber`, `.severity-red` mapped to the total score.
- Interaction table columns: Rank | Drug A | Drug B / Condition | Type | Score | Severity.

---

## Risk Scoring Logic Reference

| Dimension | Signal | Base Contribution |
|---|---|---|
| DDI (OpenFDA) | contraindicated | 20 pts per pair |
| DDI (OpenFDA) | avoid / serious | 15 pts per pair |
| DDI (OpenFDA) | caution / monitor | 8 pts per pair |
| Comorbidity | high-risk weight | 10 pts per drug-condition match |
| Comorbidity | moderate weight | 5 pts per drug-condition match |
| PGx | poor metaboliser | 2× multiplier on DDI score for that drug |
| PGx | intermediate | 1.5× multiplier on DDI score for that drug |

Total score = sum of all contributions, capped at 100.
Severity bands: 0–33 → green, 34–66 → amber, 67–100 → red.

---

## Open Questions / Decisions Already Made

| Question | Decision |
|---|---|
| Auth? | None — single open demo page |
| Database? | None — static JSON files only |
| Frontend framework? | Plain HTML/CSS/JS |
| DDI data source? | OpenFDA public API |
| PGx data source? | CPIC static JSON lookup |
| Comorbidity input? | Static JSON + UI override |
| Score display? | 0–100 with green/amber/red band + ranked interaction list |
