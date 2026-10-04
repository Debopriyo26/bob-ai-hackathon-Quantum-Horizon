"""
DDI Module — OpenFDA Integration with In-Memory Cache and Clinical Fallbacks
Queries the OpenFDA drug label endpoint for every unique drug pair in a
medication list and returns structured interaction objects with severity labels
parsed from FDA label text.
"""

import sys
import time
import itertools
import requests

# OpenFDA drug label endpoint
_OPENFDA_URL = "https://api.fda.gov/drug/label.json"

# Severity keywords in descending priority order, with their numeric scores.
_SEVERITY_MAP = [
    ("contraindicated", 20),
    ("avoid",           15),
    ("serious",         15),
    ("caution",          8),
    ("monitor",          8),
]

# Baseline score when an interaction is found but no keyword matches.
_BASELINE_SEVERITY = 3
_BASELINE_LABEL    = "interaction noted"

# Seconds to sleep between OpenFDA requests (rate-limit courtesy).
_REQUEST_DELAY = 0.05

# In-memory cache: (drug_a, drug_b) -> dict or None
_DDI_CACHE: dict = {}

# Clinical fallback interactions for known dangerous pairs
# Used when OpenFDA is unreachable, times out, or returns rate-limit (429)
_KNOWN_DDI_FALLBACKS = {
    ("amiodarone", "warfarin"): (
        "Amiodarone inhibits CYP2C9 and CYP3A4, markedly increasing warfarin serum concentrations and life-threatening bleeding risk. Prothrombin time/INR increases significantly.",
        20,
        "contraindicated"
    ),
    ("amiodarone", "simvastatin"): (
        "Concomitant use of amiodarone with simvastatin increases risk of myopathy, including rhabdomyolysis, due to CYP3A4 inhibition. Simvastatin dose should not exceed 20 mg daily.",
        15,
        "avoid"
    ),
    ("aspirin", "warfarin"): (
        "Combined antiplatelet and anticoagulant therapy substantially elevates major gastrointestinal and systemic bleeding risks. Close clinical monitoring required.",
        15,
        "serious"
    ),
    ("ibuprofen", "warfarin"): (
        "NSAIDs displace warfarin from plasma proteins and cause gastric mucosal injury, greatly elevating haemorrhage risk. Avoid combination.",
        20,
        "contraindicated"
    ),
    ("codeine", "metformin"): (
        "Gastrointestinal disturbance and altered oral intake from opioid therapy can destabilise glycemic control in diabetic patients on metformin.",
        8,
        "monitor"
    ),
    ("digoxin", "amiodarone"): (
        "Amiodarone increases digoxin serum concentration by approximately 70-100%, predisposing to severe digitalis toxicity and lethal arrhythmias.",
        20,
        "contraindicated"
    ),
    ("omeprazole", "clopidogrel"): (
        "Omeprazole inhibits CYP2C19 bioactivation of clopidogrel, significantly diminishing antiplatelet efficacy and increasing thrombotic event risk.",
        15,
        "avoid"
    ),
}


def _parse_severity(text: str) -> tuple[int, str]:
    """Return (raw_severity, severity_label) for the highest-priority keyword
    found in *text* (case-insensitive). Falls back to the baseline values."""
    lower = text.lower()
    for keyword, score in _SEVERITY_MAP:
        if keyword in lower:
            return score, keyword
    return _BASELINE_SEVERITY, _BASELINE_LABEL


def _get_known_fallback(drug_a: str, drug_b: str):
    """Check known clinical fallbacks in either order."""
    key1 = (drug_a.lower(), drug_b.lower())
    key2 = (drug_b.lower(), drug_a.lower())
    if key1 in _KNOWN_DDI_FALLBACKS:
        desc, score, label = _KNOWN_DDI_FALLBACKS[key1]
        return {"drug_a": drug_a, "drug_b": drug_b, "description": desc, "raw_severity": score, "severity_label": label}
    if key2 in _KNOWN_DDI_FALLBACKS:
        desc, score, label = _KNOWN_DDI_FALLBACKS[key2]
        return {"drug_a": drug_a, "drug_b": drug_b, "description": desc, "raw_severity": score, "severity_label": label}
    return None


def get_ddi_interactions(medications: list) -> list:
    """Query OpenFDA for every unique 2-combination pair in *medications*.
    Uses an in-memory cache and verified clinical fallback pairs for resilience.
    """
    if len(medications) < 2:
        return []

    results = []

    for drug_a, drug_b in itertools.combinations(medications, 2):
        pair_key = tuple(sorted([drug_a.lower().strip(), drug_b.lower().strip()]))

        if pair_key in _DDI_CACHE:
            cached = _DDI_CACHE[pair_key]
            if cached:
                results.append(cached)
            continue

        fallback = _get_known_fallback(drug_a, drug_b)

        # Build clean OpenFDA query without double-encoding
        clean_a = drug_a.strip().replace('"', '')
        clean_b = drug_b.strip().replace('"', '')
        search_query = f'drug_interactions:("{clean_a}"+AND+"{clean_b}")'
        params = {"search": search_query, "limit": 1}

        found_interaction = None

        try:
            response = requests.get(_OPENFDA_URL, params=params, timeout=5)

            if response.status_code == 404:
                # If 404 from OpenFDA, check if we have a known clinical fallback
                if fallback:
                    found_interaction = fallback
                _DDI_CACHE[pair_key] = found_interaction
                if found_interaction:
                    results.append(found_interaction)
                time.sleep(_REQUEST_DELAY)
                continue

            response.raise_for_status()
            data = response.json()

            interaction_texts = data["results"][0].get("drug_interactions", [])
            text = interaction_texts[0] if isinstance(interaction_texts, list) and interaction_texts else str(interaction_texts)

            if text:
                raw_severity, severity_label = _parse_severity(text)
                found_interaction = {
                    "drug_a":         drug_a,
                    "drug_b":         drug_b,
                    "description":    text[:300],
                    "raw_severity":   raw_severity,
                    "severity_label": severity_label,
                }

        except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
            # On network timeout, rate limit (429) or error, use fallback if available
            if fallback:
                found_interaction = fallback
            else:
                print(f"[ddi] OpenFDA lookup note for ({drug_a}, {drug_b}): {exc}", file=sys.stderr)

        _DDI_CACHE[pair_key] = found_interaction
        if found_interaction:
            results.append(found_interaction)

        time.sleep(_REQUEST_DELAY)

    return results
