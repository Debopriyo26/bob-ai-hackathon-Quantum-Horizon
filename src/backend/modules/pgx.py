"""
PGx Module — pharmacogenomics risk lookup.

Loads backend/data/cpic_lookup.json once at import time and builds a
drug-keyed index for O(1) per-drug lookups.
"""

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Module-level data load (once at import time)
# ---------------------------------------------------------------------------

_DATA_FILE = Path(__file__).parent.parent / "data" / "cpic_lookup.json"

with _DATA_FILE.open(encoding="utf-8") as _fh:
    _CPIC_RAW: list = json.load(_fh)

# Build a dict: normalised_drug_name -> list of CPIC entries for that drug.
# Each entry may cover a different gene, so one drug can have multiple entries.
_CPIC_BY_DRUG: dict[str, list] = {}
for _entry in _CPIC_RAW:
    _key = _entry["drug"].strip().lower()
    _CPIC_BY_DRUG.setdefault(_key, []).append(_entry)

# ---------------------------------------------------------------------------
# Metaboliser-status multiplier table
# ---------------------------------------------------------------------------

_MULTIPLIERS: dict[str, float] = {
    "poor": 2.0,
    "intermediate": 1.5,
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_pgx_risks(medications: list, pgx_profile: dict) -> list:
    """Return PGx risk entries for *medications* given a patient's *pgx_profile*.

    Parameters
    ----------
    medications:
        List of drug name strings (e.g. ``["codeine", "simvastatin"]``).
    pgx_profile:
        Dict mapping gene names to metaboliser-status strings
        (e.g. ``{"CYP2D6": "poor", "SLCO1B1": "intermediate"}``).

    Returns
    -------
    list of dict with keys: drug, gene, variant, recommendation,
    multiplier, severity.  Only entries where the patient carries a
    relevant (poor or intermediate) variant are included.
    """
    if not medications or not pgx_profile:
        return []

    # Normalise the incoming profile keys/values once.
    normalised_profile: dict[str, str] = {
        gene.strip().upper(): status.strip().lower()
        for gene, status in pgx_profile.items()
    }

    results: list = []

    for drug in medications:
        drug_key = drug.strip().lower()
        entries = _CPIC_BY_DRUG.get(drug_key)
        if not entries:
            continue

        for entry in entries:
            gene = entry["gene"].strip().upper()
            variant = normalised_profile.get(gene)

            # Skip genes not in the patient profile or with normal/unknown status.
            if variant not in _MULTIPLIERS:
                continue

            multiplier = _MULTIPLIERS[variant]

            if variant == "poor":
                recommendation = entry["poor_metaboliser_recommendation"]
            else:  # intermediate
                recommendation = entry["intermediate_metaboliser_recommendation"]

            results.append(
                {
                    "drug": drug_key,
                    "gene": gene,
                    "variant": variant,
                    "recommendation": recommendation,
                    "multiplier": multiplier,
                    "severity": entry["severity"],
                }
            )

    return results
