"""
Comorbidity Module — Sub-Task 4
Cross-references each drug in the medication list against the patient's active
comorbidities using the static comorbidity_weights.json lookup table.
"""

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Load the weights table once at module import time for performance.
# ---------------------------------------------------------------------------
_DATA_FILE = Path(__file__).parent.parent / "data" / "comorbidity_weights.json"

with _DATA_FILE.open(encoding="utf-8") as _f:
    _WEIGHTS: dict = json.load(_f)


def get_comorbidity_risks(medications: list, comorbidities: list) -> list:
    """Return per-drug risk entries for every matched drug-condition pair.

    Args:
        medications:    List of drug name strings from the patient's profile.
        comorbidities:  List of active comorbidity strings for the patient.

    Returns:
        A list of dicts with keys:
            drug      – normalised drug name (str)
            condition – normalised condition name (str)
            weight    – 10 (high risk) or 5 (moderate risk) (int)
            reason    – clinical rationale from the lookup table (str)
        Pairs not present in the lookup are silently skipped.
        Returns an empty list when either input is empty.
    """
    if not medications or not comorbidities:
        return []

    results = []

    for drug in medications:
        normalised_drug = drug.lower().strip()

        for condition in comorbidities:
            normalised_condition = condition.lower().strip()

            condition_data = _WEIGHTS.get(normalised_condition)
            if condition_data is None:
                continue

            drug_data = condition_data.get(normalised_drug)
            if drug_data is None:
                continue

            results.append({
                "drug": normalised_drug,
                "condition": normalised_condition,
                "weight": drug_data["weight"],
                "reason": drug_data["reason"],
            })

    return results
