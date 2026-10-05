"""
Clin.IQ — Flask Backend
Handles auth (signup/login), role-based patient/doctor routes,
patient profile storage (SQLite), and DDI risk assessment.
"""

import json
import sqlite3
import hashlib
import secrets
import os
import shutil
import tempfile
from pathlib import Path

# pyrefly: ignore [missing-import]
from flask import Flask, jsonify, request, g, send_from_directory
from flask_cors import CORS

from modules.ddi import get_ddi_interactions
from modules.comorbidity import get_comorbidity_risks
from modules.pgx import get_pgx_risks
from scorer import compute_risk
try:
    import frontend  # noqa: F401
except ImportError:
    pass

_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = Flask(__name__, static_folder=str(_FRONTEND_DIR), static_url_path="")
CORS(app, supports_credentials=True)

_IS_SERVERLESS = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
_ORIG_DB_PATH = Path(__file__).resolve().parent / "data" / "cliniq.db"
_DEMO_PATIENT_FILE = Path(__file__).resolve().parent / "data" / "patient_demo.json"

if _IS_SERVERLESS:
    _TMP_DIR = Path(tempfile.gettempdir())
    _DB_PATH = _TMP_DIR / "cliniq.db"
else:
    _DB_PATH = _ORIG_DB_PATH

# ── In-memory session store: token → {user_id, role} ──────────────────────
_sessions: dict = {}


# ── Database helpers ───────────────────────────────────────────────────────

def _ensure_db_ready():
    """Ensure the SQLite DB file is available and initialized, especially in serverless."""
    if _IS_SERVERLESS and not _DB_PATH.exists():
        if _ORIG_DB_PATH.exists():
            try:
                shutil.copyfile(str(_ORIG_DB_PATH), str(_DB_PATH))
                return
            except Exception:
                pass
        _init_db()


def _get_db():
    if "db" not in g:
        _ensure_db_ready()
        g.db = sqlite3.connect(str(_DB_PATH), timeout=20.0)
        g.db.row_factory = sqlite3.Row
        try:
            g.db.execute("PRAGMA journal_mode=WAL")
        except Exception:
            try:
                g.db.execute("PRAGMA journal_mode=DELETE")
            except Exception:
                pass
    return g.db


@app.teardown_appcontext
def _close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _init_db():
    """Create tables if they don't exist and seed the demo patient."""
    try:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    db = sqlite3.connect(str(_DB_PATH), timeout=20.0)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            email    TEXT    UNIQUE NOT NULL,
            name     TEXT    NOT NULL,
            role     TEXT    NOT NULL CHECK(role IN ('patient','doctor')),
            pw_hash  TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS patient_profiles (
            user_id       INTEGER PRIMARY KEY REFERENCES users(id),
            age           INTEGER,
            sex           TEXT,
            weight_kg     REAL,
            medications   TEXT DEFAULT '[]',
            comorbidities TEXT DEFAULT '[]',
            pgx_profile   TEXT DEFAULT '{}'
        );
    """)
    db.commit()

    # Seed demo doctor and demo patient if they don't exist yet
    def _hash(pw):
        return hashlib.sha256(pw.encode()).hexdigest()

    existing = db.execute("SELECT id FROM users WHERE email IN (?,?)",
                          ("doctor@cliniq.demo", "patient@cliniq.demo")).fetchall()
    if not existing:
        db.execute("INSERT INTO users (email,name,role,pw_hash) VALUES (?,?,?,?)",
                   ("doctor@cliniq.demo", "Dr. Sarah Chen", "doctor", _hash("demo1234")))
        db.execute("INSERT INTO users (email,name,role,pw_hash) VALUES (?,?,?,?)",
                   ("patient@cliniq.demo", "James Harrington", "patient", _hash("demo1234")))
        db.commit()

        doctor_id = db.execute("SELECT id FROM users WHERE email=?",
                               ("doctor@cliniq.demo",)).fetchone()["id"]  # noqa: F841
        patient_id = db.execute("SELECT id FROM users WHERE email=?",
                                ("patient@cliniq.demo",)).fetchone()["id"]

        # Load demo patient profile from static JSON
        with _DEMO_PATIENT_FILE.open() as f:
            demo = json.load(f)
        db.execute("""
            INSERT INTO patient_profiles
                (user_id, age, sex, weight_kg, medications, comorbidities, pgx_profile)
            VALUES (?,?,?,?,?,?,?)
        """, (
            patient_id,
            demo.get("age"),
            demo.get("sex"),
            demo.get("weight_kg"),
            json.dumps(demo.get("medications", [])),
            json.dumps(demo.get("comorbidities", [])),
            json.dumps(demo.get("pgx_profile", {})),
        ))
        db.commit()

    db.close()


# ── Auth helpers ───────────────────────────────────────────────────────────

def _hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def _get_current_user():
    """Read Bearer token from Authorization header; return user row or None."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    session = _sessions.get(token)
    if not session:
        return None
    db = _get_db()
    return db.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()


def _require_role(*roles):
    """Return (user_row, None) or (None, error_response) for role enforcement."""
    user = _get_current_user()
    if user is None:
        return None, (jsonify({"error": "Authentication required"}), 401)
    if user["role"] not in roles:
        return None, (jsonify({"error": "Forbidden"}), 403)
    return user, None


# ── Static Frontend Routes (Serves the UI directly on port 5000) ───────────

def _find_static_file(filename):
    task_dir = Path(__file__).resolve().parent
    candidates = [
        task_dir / "frontend",
        task_dir,
        task_dir.parent / "frontend",
        task_dir.parent,
        _FRONTEND_DIR
    ]
    for d in candidates:
        target = d / filename
        if target.is_file():
            return target, d
    return None, None


@app.route("/")
def serve_index():
    path, d = _find_static_file("auth.html")
    if not path:
        path, d = _find_static_file("index.html")
    if path:
        return send_from_directory(str(d), path.name)
    return jsonify({"status": "ok", "app": "Clin.IQ"}), 200


@app.route("/api/debug-paths")
def debug_paths():
    base = Path(__file__).resolve().parent
    root = base.parent
    task = Path("/var/task")
    return jsonify({
        "file": str(__file__),
        "base": str(base),
        "root": str(root),
        "base_contents": [p.name for p in base.iterdir()] if base.is_dir() else [],
        "root_contents": [p.name for p in root.iterdir()] if root.is_dir() else [],
        "task_contents": [p.name for p in task.iterdir()] if task.is_dir() else []
    })


@app.route("/<path:filename>")
def serve_static(filename):
    path, d = _find_static_file(filename)
    if path:
        return send_from_directory(str(d), filename)
    return jsonify({"error": f"File '{filename}' not found"}), 404


# ── Auth routes ────────────────────────────────────────────────────────────

@app.route("/api/auth/signup", methods=["POST"])
def signup():
    body = request.get_json(force=True, silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    name  = (body.get("name") or "").strip()
    role  = (body.get("role") or "").strip().lower()
    pw    = body.get("password", "")

    if not all([email, name, role, pw]):
        return jsonify({"error": "email, name, role, and password are required"}), 400
    if role not in ("patient", "doctor"):
        return jsonify({"error": "role must be 'patient' or 'doctor'"}), 400
    if len(pw) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    db = _get_db()
    if db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
        return jsonify({"error": "Email already registered"}), 409

    cur = db.execute(
        "INSERT INTO users (email,name,role,pw_hash) VALUES (?,?,?,?)",
        (email, name, role, _hash_pw(pw))
    )
    db.commit()
    user_id = cur.lastrowid

    if role == "patient":
        db.execute("INSERT INTO patient_profiles (user_id) VALUES (?)", (user_id,))
        db.commit()

    token = secrets.token_hex(32)
    _sessions[token] = {"user_id": user_id, "role": role}

    return jsonify({"token": token, "role": role, "name": name, "user_id": user_id}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    body  = request.get_json(force=True, silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    pw    = body.get("password", "")

    db   = _get_db()
    user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()

    if user is None or user["pw_hash"] != _hash_pw(pw):
        return jsonify({"error": "Invalid email or password"}), 401

    token = secrets.token_hex(32)
    _sessions[token] = {"user_id": user["id"], "role": user["role"]}

    return jsonify({
        "token":   token,
        "role":    user["role"],
        "name":    user["name"],
        "user_id": user["id"],
    }), 200


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        _sessions.pop(auth[7:], None)
    return jsonify({"ok": True}), 200


@app.route("/api/auth/me", methods=["GET"])
def me():
    user = _get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    return jsonify({"user_id": user["id"], "name": user["name"], "role": user["role"], "email": user["email"]}), 200


# ── Patient routes ─────────────────────────────────────────────────────────

@app.route("/api/patient/profile", methods=["GET"])
def get_own_profile():
    user, err = _require_role("patient")
    if err:
        return err
    db = _get_db()
    row = db.execute("SELECT * FROM patient_profiles WHERE user_id=?", (user["id"],)).fetchone()
    if not row:
        return jsonify({"error": "Profile not found"}), 404
    return jsonify(_serialize_profile(user, row)), 200


@app.route("/api/patient/profile", methods=["PUT"])
def update_own_profile():
    user, err = _require_role("patient")
    if err:
        return err
    body = request.get_json(force=True, silent=True) or {}
    db   = _get_db()

    db.execute("""
        INSERT INTO patient_profiles (user_id, age, sex, weight_kg, medications, comorbidities, pgx_profile)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
            age=excluded.age,
            sex=excluded.sex,
            weight_kg=excluded.weight_kg,
            medications=excluded.medications,
            comorbidities=excluded.comorbidities,
            pgx_profile=excluded.pgx_profile
    """, (
        user["id"],
        body.get("age"),
        body.get("sex"),
        body.get("weight_kg"),
        json.dumps(body.get("medications", [])),
        json.dumps(body.get("comorbidities", [])),
        json.dumps(body.get("pgx_profile", {})),
    ))
    db.commit()
    row = db.execute("SELECT * FROM patient_profiles WHERE user_id=?", (user["id"],)).fetchone()
    return jsonify(_serialize_profile(user, row)), 200


# ── Doctor routes ──────────────────────────────────────────────────────────

@app.route("/api/doctor/patients", methods=["GET"])
def list_patients():
    _, err = _require_role("doctor")
    if err:
        return err
    db = _get_db()
    rows = db.execute("""
        SELECT u.id, u.name, u.email,
               p.age, p.sex, p.weight_kg,
               p.medications, p.comorbidities, p.pgx_profile
        FROM users u
        LEFT JOIN patient_profiles p ON p.user_id = u.id
        WHERE u.role = 'patient'
        ORDER BY u.name
    """).fetchall()

    patients = []
    for r in rows:
        meds = _safe_json(r["medications"], [])
        pgx  = _safe_json(r["pgx_profile"], {})
        pgx_flags = [g for g, s in pgx.items() if str(s).lower() in ("poor", "intermediate")]
        patients.append({
            "user_id":       r["id"],
            "name":          r["name"],
            "email":         r["email"],
            "age":           r["age"],
            "sex":           r["sex"],
            "weight_kg":     r["weight_kg"],
            "med_count":     len(meds),
            "has_pgx_flags": len(pgx_flags) > 0,
            "pgx_count":     len(pgx_flags),
        })
    return jsonify(patients), 200


@app.route("/api/doctor/patients/<int:patient_id>", methods=["GET"])
def get_patient_profile(patient_id):
    _, err = _require_role("doctor")
    if err:
        return err
    db   = _get_db()
    user = db.execute("SELECT * FROM users WHERE id=? AND role='patient'", (patient_id,)).fetchone()
    if not user:
        return jsonify({"error": "Patient not found"}), 404
    row = db.execute("SELECT * FROM patient_profiles WHERE user_id=?", (patient_id,)).fetchone()
    return jsonify(_serialize_profile(user, row)), 200


@app.route("/api/doctor/patients/<int:patient_id>/assess", methods=["POST"])
def assess_patient(patient_id):
    _, err = _require_role("doctor")
    if err:
        return err
    db   = _get_db()
    user = db.execute("SELECT * FROM users WHERE id=? AND role='patient'", (patient_id,)).fetchone()
    if not user:
        return jsonify({"error": "Patient not found"}), 404
    row  = db.execute("SELECT * FROM patient_profiles WHERE user_id=?", (patient_id,)).fetchone()

    medications   = _safe_json(row["medications"] if row else None, [])
    comorbidities = _safe_json(row["comorbidities"] if row else None, [])
    pgx_profile   = _safe_json(row["pgx_profile"] if row else None, {})

    if not medications:
        return jsonify({"error": "Patient has no medications on record"}), 400

    try:
        ddi_results         = get_ddi_interactions(medications)
        comorbidity_results = get_comorbidity_risks(medications, comorbidities)
        pgx_results         = get_pgx_risks(medications, pgx_profile)
        result              = compute_risk(ddi_results, comorbidity_results, pgx_results)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": "Assessment failed", "detail": str(e)}), 500


# ── Legacy / self-assess route (still works for the patient portal) ────────

@app.route("/api/assess", methods=["POST"])
def assess():
    user, err = _require_role("patient")
    if err:
        return err
    try:
        body = request.get_json(force=True, silent=True) or {}
        medications   = body.get("medications")
        if not medications:
            return jsonify({"error": "medications list is required"}), 400
        comorbidities = body.get("comorbidities", [])
        pgx_profile   = body.get("pgx_profile", {})

        ddi_results         = get_ddi_interactions(medications)
        comorbidity_results = get_comorbidity_risks(medications, comorbidities)
        pgx_results         = get_pgx_risks(medications, pgx_profile)
        result              = compute_risk(ddi_results, comorbidity_results, pgx_results)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": "Internal server error", "detail": str(e)}), 500


# Safe alternative suggestions keyed by drug name (lowercase).
# Used when a drug is flagged RED by DDI or PGx.
_ALTERNATIVES = {
    "simvastatin":  "Consider switching Simvastatin to Pravastatin (non-CYP3A4 substrate, renally excreted) to avoid CYP3A4 inhibition and SLCO1B1 myopathy risk (or Rosuvastatin at low dose).",
    "codeine":      "Consider switching Codeine to low-dose Morphine or multimodal non-opioid analgesia. Avoid Codeine and Tramadol in CYP2D6 poor metabolisers due to lack of conversion to active morphine.",
    "warfarin":     "Consider switching Warfarin to a Direct Oral Anticoagulant (DOAC) such as Apixaban (5 mg BID) or Rivaroxaban to bypass CYP2C9 interaction risks, subject to renal function.",
    "amiodarone":   "Consider switching Amiodarone to Dronedarone for rhythm control or Bisoprolol for rate control to reduce hepatic/pulmonary toxicity and CYP3A4 inhibition.",
    "metformin":    "If eGFR is below 30 or patient has severe renal impairment, consider switching to Linagliptin (DPP-4 inhibitor) or SGLT-2 inhibitor with renal adjustment to prevent lactic acidosis.",
    "clopidogrel":  "In CYP2C19 poor metabolisers, switch Clopidogrel to Ticagrelor (90 mg BID) or Prasugrel (10 mg daily), which bypass CYP2C19 activation entirely.",
    "omeprazole":   "Consider switching Omeprazole to Pantoprazole (less CYP2C19-dependent) or Famotidine (H2 blocker, no CYP involvement) to reduce pharmacogenomic interaction.",
    "tramadol":     "For CYP2D6 poor metabolisers, consider switching Tramadol to Buprenorphine (no CYP2D6 activation needed) or Tapentadol / Pregabalin depending on pain aetiology.",
    "azathioprine": "In TPMT poor metabolisers, consider switching Azathioprine to Mycophenolate Mofetil to prevent severe life-threatening myelosuppression.",
    "fluorouracil": "In DPYD-deficient patients, consider switching Fluorouracil to an alternative non-fluoropyrimidine chemotherapy regimen (e.g. Oxaliplatin-based) to avoid lethal systemic toxicity.",
}

# Comorbidity-specific prescribing notes
_COMORB_NOTES = {
    "renal_impairment": "Renal impairment present: dose adjustments required for renally-cleared medications. Avoid nephrotoxic agents and monitor eGFR.",
    "hepatic_impairment": "Hepatic impairment present: reduce dose or substitute drugs requiring hepatic CYP clearance. Liver function tests indicated.",
    "heart_failure": "Heart failure present: negative inotropes and fluid-retaining agents (NSAIDs, diltiazem) are contraindicated.",
    "diabetes": "Diabetic regimen: monitor glycemic control closely for drug-induced destabilisation.",
    "hypertension": "Hypertension present: avoid NSAIDs and sympathomimetic agents that antagonise antihypertensive therapy.",
    "atrial_fibrillation": "Atrial fibrillation: ensure rate and anticoagulation therapies avoid additive negative chronotropy or haemorrhage risks.",
}


def _generate_watsonx_ai_insights(medications: list, comorbidities: list, pgx_profile: dict) -> dict:
    """Simulated IBM watsonx.ai Foundation Model Clinical Co-Pilot.

    Evaluates the doctor's prescribed medicine list against comorbidities and
    pharmacogenomics (PGx) profile.
    Generates a natural-language clinical risk summary, identifies RED-flagged
    drugs, and explicitly suggests safe alternative medications.
    """
    from datetime import datetime, timezone
    meds_lower = [m.lower().strip() for m in medications]
    comorbs    = [c.lower().strip() for c in comorbidities]
    pgx_flags  = {g.upper(): s.lower() for g, s in pgx_profile.items() if s.lower() in ("poor", "intermediate")}

    red_flags = []
    safe_alternatives = []
    seen_alts = set()

    # ── 1. Evaluate PGx Contraindications (RED Flags) ────────────────────
    for gene, status in pgx_flags.items():
        affected = [m for m in meds_lower if any(
            e["gene"].upper() == gene and e["drug"].lower() == m
            for e in _CPIC_DATA
        )]
        for drug in affected:
            alt = _ALTERNATIVES.get(drug)
            is_red = status == "poor" or drug in ("simvastatin", "codeine", "clopidogrel", "fluorouracil", "azathioprine")
            if is_red:
                reason = f"{drug.capitalize()} metabolised via {gene} ({status} metaboliser) — high risk of toxic accumulation or therapy failure."
                red_flags.append({
                    "drug": drug,
                    "drug_display": drug.capitalize(),
                    "severity": "RED",
                    "reason": reason,
                    "gene": gene,
                    "status": status,
                    "suggested_alternative": alt or f"Consider non-{gene} dependent alternative agent."
                })
                if alt and alt not in seen_alts:
                    safe_alternatives.append(alt)
                    seen_alts.add(alt)

    # ── 2. Evaluate Known High-Severity DDI Pairs (RED Flags) ─────────────
    _HIGH_DDI_PAIRS = [
        ("warfarin", "amiodarone", "Amiodarone inhibits CYP2C9/CYP3A4, markedly potentiating Warfarin anticoagulation with severe bleeding risk."),
        ("amiodarone", "simvastatin", "Amiodarone inhibits CYP3A4 metabolism of Simvastatin, drastically increasing plasma levels and risk of fatal rhabdomyolysis."),
        ("warfarin", "simvastatin", "Simvastatin can potentiate Warfarin anticoagulation; close INR monitoring or statin switch required."),
        ("metformin", "contrast", "Risk of contrast-induced acute renal failure and metformin-associated lactic acidosis."),
    ]
    for drug_a, drug_b, desc in _HIGH_DDI_PAIRS:
        if drug_a in meds_lower and drug_b in meds_lower:
            target_drug = drug_b if drug_b in ("simvastatin", "amiodarone") else drug_a
            alt = _ALTERNATIVES.get(target_drug)
            red_flags.append({
                "drug": target_drug,
                "drug_display": target_drug.capitalize(),
                "severity": "RED",
                "reason": f"DDI Alert ({drug_a.capitalize()} + {drug_b.capitalize()}): {desc}",
                "suggested_alternative": alt or f"Review dosing or switch {target_drug.capitalize()}."
            })
            if alt and alt not in seen_alts:
                safe_alternatives.append(alt)
                seen_alts.add(alt)

    # ── 3. Comorbidity High Risks ─────────────────────────────────────────
    for comorb in comorbs:
        weights = _COMORB_WEIGHTS.get(comorb, {})
        for drug in meds_lower:
            entry = weights.get(drug)
            if entry and entry.get("weight", 0) >= 10:
                alt = _ALTERNATIVES.get(drug)
                red_flags.append({
                    "drug": drug,
                    "drug_display": drug.capitalize(),
                    "severity": "RED",
                    "reason": f"Comorbidity Contraindication ({comorb.replace('_', ' ')}): {entry['reason']}",
                    "suggested_alternative": alt or f"Consider dose adjustment or condition-safe alternative for {drug.capitalize()}."
                })
                if alt and alt not in seen_alts:
                    safe_alternatives.append(alt)
                    seen_alts.add(alt)

    # De-duplicate red flags by drug
    dedup_red_flags = []
    seen_drugs = set()
    for rf in red_flags:
        if rf["drug"] not in seen_drugs:
            dedup_red_flags.append(rf)
            seen_drugs.add(rf["drug"])

    # Determine overall risk level
    poly = len(meds_lower) >= 5
    if len(dedup_red_flags) > 0:
        risk_level = "HIGH"
    elif poly or len(pgx_flags) > 0 or len(comorbs) > 0:
        risk_level = "MODERATE"
    else:
        risk_level = "LOW"

    # ── 4. Synthesise Natural-Language Risk Summary ───────────────────────
    if dedup_red_flags:
        flagged_names = ", ".join(rf["drug_display"] for rf in dedup_red_flags)
        risk_summary = (
            f"Prescription review identifies critical high-risk interactions for {flagged_names}. "
            f"Patient carries significant pharmacogenomic vulnerabilities ({', '.join(pgx_flags.keys()) or 'active variants'}) "
            f"amplified by {len(comorbs)} active comorbid condition(s) and polypharmacy ({len(meds_lower)} medications)."
        )
    elif poly:
        risk_summary = (
            f"Regimen involves {len(meds_lower)} concurrent medications (polypharmacy). "
            f"While no immediate absolute contraindications are active, cumulative metabolic burden requires vigilant monitoring."
        )
    else:
        risk_summary = (
            f"Low immediate interaction risk identified across {len(meds_lower)} prescribed medication(s). "
            f"Dosages and comorbid tolerances appear aligned with clinical guidelines."
        )

    # ── 5. Build Comprehensive Narrative Text ─────────────────────────────
    narrative_lines = [
        f"🤖 IBM watsonx.ai Clinical Co-Pilot Assessment",
        f"Model: ibm/granite-13b-instruct-v2 | Regimen: {len(meds_lower)} Medications Evaluated\n",
        f"Risk Summary:\n{risk_summary}\n",
    ]

    if dedup_red_flags:
        narrative_lines.append("🚨 RED-Flagged Medications & Contraindications:")
        for rf in dedup_red_flags:
            narrative_lines.append(f"  • [{rf['severity']}] {rf['drug_display']}: {rf['reason']}")
        narrative_lines.append("")

    if safe_alternatives:
        narrative_lines.append("💡 Explicit Safe Alternative Suggestions:")
        for alt in safe_alternatives:
            narrative_lines.append(f"  • {alt}")
        narrative_lines.append("")

    if comorbs:
        narrative_lines.append("🩺 Comorbidity Guidance:")
        for c in comorbs:
            note = _COMORB_NOTES.get(c)
            if note:
                narrative_lines.append(f"  • {c.replace('_', ' ').title()}: {note}")

    full_insight = "\n".join(narrative_lines)

    return {
        "provider": "IBM watsonx.ai",
        "model_id": "ibm/granite-13b-instruct-v2",
        "runtime": "watsonx.ai Foundation Models",
        "status": "success",
        "risk_level": risk_level,
        "risk_summary": risk_summary,
        "red_flags": dedup_red_flags,
        "safe_alternatives": safe_alternatives,
        "insight": full_insight,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "evaluated_counts": {
            "medications": len(meds_lower),
            "comorbidities": len(comorbs),
            "pgx_flags": len(pgx_flags),
            "red_flag_count": len(dedup_red_flags)
        }
    }


def _generate_clinical_insights(medications: list, comorbidities: list, pgx_profile: dict) -> str:
    """Backward compatibility wrapper returning formatted plain text."""
    res = _generate_watsonx_ai_insights(medications, comorbidities, pgx_profile)
    return res["insight"]


# Pre-load CPIC and comorbidity data for the insights engine at module level
_CPIC_DATA     = json.loads((Path(__file__).resolve().parent / "data" / "cpic_lookup.json").read_text(encoding="utf-8"))
_COMORB_WEIGHTS = json.loads((Path(__file__).resolve().parent / "data" / "comorbidity_weights.json").read_text(encoding="utf-8"))


@app.route("/api/ai-assessment", methods=["GET", "POST"])
def ai_assessment():
    """Mock AI endpoint simulating IBM watsonx.ai Clinical Co-Pilot.

    Evaluates doctor's prescribed medicine list against patient comorbidities and PGx profile.
    Returns simulated IBM watsonx.ai response containing short natural-language risk summary,
    and explicitly suggests safe alternative medications for RED-flagged drugs.
    """
    if request.method == "GET":
        patient_id = request.args.get("patient_id")
        if patient_id:
            db = _get_db()
            row = db.execute("SELECT * FROM patient_profiles WHERE user_id=?", (patient_id,)).fetchone()
            if row:
                meds = _safe_json(row["medications"], [])
                comorbs = _safe_json(row["comorbidities"], [])
                pgx = _safe_json(row["pgx_profile"], {})
                return jsonify(_generate_watsonx_ai_insights(meds, comorbs, pgx)), 200
        return jsonify({
            "status": "ready",
            "provider": "IBM watsonx.ai",
            "model_id": "ibm/granite-13b-instruct-v2",
            "message": "IBM watsonx.ai Clinical Co-Pilot API is active. Send a POST request with medications, comorbidities, and pgx_profile, or pass ?patient_id=<id> via GET.",
            "usage": {
                "method": "POST",
                "headers": {"Content-Type": "application/json", "Authorization": "Bearer <doctor_token>"},
                "body": {"medications": ["simvastatin", "codeine"], "comorbidities": ["renal_impairment"], "pgx_profile": {"CYP2D6": "poor", "SLCO1B1": "poor"}}
            }
        }), 200

    _, err = _require_role("doctor")
    if err:
        return err

    body          = request.get_json(force=True, silent=True) or {}
    medications   = body.get("medications")
    comorbidities = body.get("comorbidities")
    pgx_profile   = body.get("pgx_profile")

    # If patient_id provided and fields missing, load directly from DB
    patient_id = body.get("patient_id")
    if patient_id and (medications is None or comorbidities is None or pgx_profile is None):
        db = _get_db()
        row = db.execute("SELECT * FROM patient_profiles WHERE user_id=?", (patient_id,)).fetchone()
        if row:
            if medications is None:
                medications = _safe_json(row["medications"], [])
            if comorbidities is None:
                comorbidities = _safe_json(row["comorbidities"], [])
            if pgx_profile is None:
                pgx_profile = _safe_json(row["pgx_profile"], {})

    medications   = medications or []
    comorbidities = comorbidities or []
    pgx_profile   = pgx_profile or {}

    if not medications:
        return jsonify({
            "provider": "IBM watsonx.ai",
            "model_id": "ibm/granite-13b-instruct-v2",
            "risk_level": "LOW",
            "risk_summary": "No medications currently prescribed for this patient.",
            "red_flags": [],
            "safe_alternatives": [],
            "insight": "No medications recorded. Regimen evaluation clear.",
            "status": "success"
        }), 200

    response_data = _generate_watsonx_ai_insights(medications, comorbidities, pgx_profile)
    return jsonify(response_data), 200


@app.route("/api/rx-check", methods=["POST"])
def rx_check():
    """Prescription Safety Checker — evaluates a single new drug against patient profile."""
    _, err = _require_role("doctor")
    if err:
        return err

    body          = request.get_json(force=True, silent=True) or {}
    new_drug      = (body.get("drug") or "").strip().lower()
    medications   = [m.lower() for m in body.get("medications", [])]
    comorbidities = [c.lower() for c in body.get("comorbidities", [])]
    pgx_profile   = {g.upper(): s.lower() for g, s in body.get("pgx_profile", {}).items()}
    age           = body.get("age")
    sex           = (body.get("sex") or "").lower()

    if not new_drug:
        return jsonify({"error": "drug name is required"}), 400

    verdict, explanation = _check_prescription_safety(
        new_drug, medications, comorbidities, pgx_profile, age, sex
    )
    return jsonify({"drug": new_drug, "verdict": verdict, "explanation": explanation}), 200


def _check_prescription_safety(
    new_drug: str,
    current_meds: list,
    comorbidities: list,
    pgx_profile: dict,
    age,
    sex: str,
) -> tuple:
    """Return (verdict, explanation).
    verdict is 'safe', 'warning', or 'contraindicated'.
    """
    flags = []
    severity = "safe"

    # ── 1. Duplicate check ────────────────────────────────────────────────
    if new_drug in current_meds:
        flags.append(f"{new_drug.capitalize()} is already in this patient's medication list — prescribing a duplicate is not recommended.")
        severity = "contraindicated"

    # ── 2. PGx check against CPIC data ───────────────────────────────────
    for entry in _CPIC_DATA:
        if entry["drug"].lower() == new_drug:
            gene   = entry["gene"].upper()
            status = pgx_profile.get(gene)
            if status == "poor":
                flags.append(
                    f"PGx Alert — {gene} poor metaboliser: {entry['poor_metaboliser_recommendation']}"
                )
                if entry.get("severity") == "high":
                    severity = "contraindicated"
                elif severity != "contraindicated":
                    severity = "warning"
            elif status == "intermediate":
                flags.append(
                    f"PGx Note — {gene} intermediate metaboliser: {entry['intermediate_metaboliser_recommendation']}"
                )
                if severity == "safe":
                    severity = "warning"

    # ── 3. Comorbidity check ──────────────────────────────────────────────
    for comorb in comorbidities:
        comorb_weights = _COMORB_WEIGHTS.get(comorb, {})
        entry = comorb_weights.get(new_drug)
        if entry:
            w = entry.get("weight", 0)
            flags.append(
                f"Comorbidity ({comorb.replace('_', ' ')}) — {entry['reason']}"
            )
            if w >= 10 and severity != "contraindicated":
                severity = "warning"

    # ── 4. Known high-severity pair check ────────────────────────────────
    _DANGER_PAIRS = {
        ("warfarin",   "amiodarone"): "Amiodarone severely potentiates warfarin — life-threatening bleeding risk.",
        ("warfarin",   "aspirin"):    "Dual antithrombotic therapy greatly increases haemorrhage risk.",
        ("warfarin",   "ibuprofen"):  "NSAIDs displace warfarin from protein binding and inhibit platelet function.",
        ("metformin",  "contrast"):   "IV contrast media with metformin — risk of contrast-induced lactic acidosis.",
        ("simvastatin","amiodarone"): "Amiodarone inhibits CYP3A4 — elevated simvastatin plasma levels cause myopathy.",
        ("ssri",       "tramadol"):   "Serotonin syndrome risk with combined serotonergic agents.",
        ("digoxin",    "amiodarone"): "Amiodarone doubles digoxin plasma levels — narrow therapeutic index toxicity.",
        ("lithium",    "ibuprofen"):  "NSAIDs reduce renal lithium clearance — lithium toxicity risk.",
    }
    for (drug_a, drug_b), msg in _DANGER_PAIRS.items():
        if (new_drug == drug_a and drug_b in current_meds) or \
           (new_drug == drug_b and drug_a in current_meds):
            flags.append(f"Known dangerous combination: {msg}")
            if severity != "contraindicated":
                severity = "warning"

    # ── 5. Age-related cautions ───────────────────────────────────────────
    _ELDERLY_CAUTION = {
        "diazepam":    "Benzodiazepines are high-risk in elderly patients — fall and confusion risk (Beers criteria).",
        "amitriptyline": "Tricyclic antidepressants carry high anticholinergic burden in elderly — Beers criteria.",
        "indomethacin": "High-risk NSAID in elderly — GI bleeding, renal impairment, CNS effects.",
        "glibenclamide": "Long-acting sulphonylurea — high hypoglycaemia risk in elderly patients.",
        "nitrofurantoin": "Reduced renal function in elderly limits efficacy and increases toxicity risk.",
    }
    if age and int(age) >= 65 and new_drug in _ELDERLY_CAUTION:
        flags.append(f"Elderly patient caution (age {age}): {_ELDERLY_CAUTION[new_drug]}")
        if severity == "safe":
            severity = "warning"

    # ── 6. Sex-specific cautions ──────────────────────────────────────────
    if sex == "female" and new_drug in ("warfarin", "phenytoin", "carbamazepine"):
        flags.append(f"{new_drug.capitalize()} has teratogenic potential — confirm pregnancy status before prescribing.")
        if severity == "safe":
            severity = "warning"

    # ── Build explanation ─────────────────────────────────────────────────
    if not flags:
        explanation = (
            f"No known contraindications or high-risk interactions identified for {new_drug.capitalize()} "
            f"in this patient's profile. Standard dosing guidelines and routine monitoring apply."
        )
    else:
        explanation = f"Evaluation of {new_drug.capitalize()} against this patient's profile:\n\n"
        explanation += "\n".join(f"  • {f}" for f in flags)
        alt = _ALTERNATIVES.get(new_drug)
        if alt and severity in ("warning", "contraindicated"):
            explanation += f"\n\nSuggested Alternative: {alt}"

    return severity, explanation


# ── Helpers ────────────────────────────────────────────────────────────────

def _serialize_profile(user, row) -> dict:
    if row is None:
        return {
            "user_id": user["id"], "name": user["name"],
            "email": user["email"],
            "age": None, "sex": None, "weight_kg": None,
            "medications": [], "comorbidities": [], "pgx_profile": {},
        }
    return {
        "user_id":      user["id"],
        "name":         user["name"],
        "email":        user["email"],
        "age":          row["age"],
        "sex":          row["sex"],
        "weight_kg":    row["weight_kg"],
        "medications":  _safe_json(row["medications"], []),
        "comorbidities": _safe_json(row["comorbidities"], []),
        "pgx_profile":  _safe_json(row["pgx_profile"], {}),
    }


def _safe_json(val, default):
    if val is None:
        return default
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default


# ── Bootstrap ──────────────────────────────────────────────────────────────
# In local development, initialise DB before server starts.
# In serverless environments, DB is prepared lazily in /tmp via _ensure_db_ready().
if not _IS_SERVERLESS and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
    try:
        _init_db()
    except Exception as _e:
        print(f"Warning: _init_db failed: {_e}")

if __name__ == "__main__":
    _init_db()
    app.run(debug=False, port=5000)
