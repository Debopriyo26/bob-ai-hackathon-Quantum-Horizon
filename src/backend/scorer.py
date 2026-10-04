"""
Risk Scorer — Sub-Task 6
Aggregates DDI, comorbidity, and PGx module outputs into a single 0-100
risk score and a ranked list of interactions with per-item severity bands.
"""


def _item_severity_band(score: float) -> str:
    """Per-item severity band based on a 20-point maximum reference."""
    if score >= 15:
        return "red"
    if score >= 8:
        return "amber"
    return "green"


def _overall_severity_band(total: int) -> str:
    """Overall severity band: 0-33 green, 34-66 amber, 67-100 red."""
    if total <= 33:
        return "green"
    if total <= 66:
        return "amber"
    return "red"


def compute_risk(
    ddi_results: list,
    comorbidity_results: list,
    pgx_results: list,
) -> dict:
    """Aggregate module outputs into a risk score and ranked interaction list.

    Parameters
    ----------
    ddi_results:
        List of dicts from ``ddi.get_ddi_interactions``.
        Expected keys: drug_a, drug_b, description, raw_severity, severity_label.

    comorbidity_results:
        List of dicts from ``comorbidity.get_comorbidity_risks``.
        Expected keys: drug, condition, weight, reason.

    pgx_results:
        List of dicts from ``pgx.get_pgx_risks``.
        Expected keys: drug, gene, variant, recommendation, multiplier, severity.

    Returns
    -------
    dict with keys:
        total_score   – int 0-100
        severity_band – "green" | "amber" | "red"
        interactions  – list of ranked interaction dicts, each containing:
                        rank, type, drug_a, drug_b, description,
                        score_contribution, severity_band
    """
    # ------------------------------------------------------------------
    # Step 1 — Build PGx multiplier map keyed by lowercase drug name.
    # When a drug appears more than once (different genes), keep the highest
    # multiplier so DDI scoring uses the most conservative value.
    # ------------------------------------------------------------------
    pgx_multipliers: dict = {}
    for pgx in pgx_results:
        drug_key = pgx["drug"].lower()
        if pgx["multiplier"] > pgx_multipliers.get(drug_key, 1.0):
            pgx_multipliers[drug_key] = pgx["multiplier"]

    # ------------------------------------------------------------------
    # Step 2 — Score DDI pairs, applying the PGx multiplier where relevant.
    # ------------------------------------------------------------------
    # Collect the set of drug names already covered by at least one DDI entry
    # (used in Step 4 to avoid duplicating standalone PGx contributions).
    ddi_drug_names: set = set()

    interactions: list = []

    for ddi in ddi_results:
        drug_a = ddi["drug_a"]
        drug_b = ddi["drug_b"]

        ddi_drug_names.add(drug_a.lower())
        ddi_drug_names.add(drug_b.lower())

        pgx_mult_a = pgx_multipliers.get(drug_a.lower(), 1.0)
        pgx_mult_b = pgx_multipliers.get(drug_b.lower(), 1.0)
        pair_multiplier = max(pgx_mult_a, pgx_mult_b)

        score_contribution = round(ddi["raw_severity"] * pair_multiplier, 1)

        interactions.append({
            "type": "DDI",
            "drug_a": drug_a,
            "drug_b": drug_b,
            "description": ddi["description"],
            "score_contribution": score_contribution,
        })

    # ------------------------------------------------------------------
    # Step 3 — Score comorbidity contributions.
    # ------------------------------------------------------------------
    for comorbidity in comorbidity_results:
        interactions.append({
            "type": "Comorbidity",
            "drug_a": comorbidity["drug"],
            "drug_b": comorbidity["condition"],
            "description": comorbidity["reason"],
            "score_contribution": float(comorbidity["weight"]),
        })

    # ------------------------------------------------------------------
    # Step 4 — Add standalone PGx entries for drugs not already in a DDI pair.
    # ------------------------------------------------------------------
    for pgx in pgx_results:
        if pgx["drug"].lower() in ddi_drug_names:
            continue

        score_contribution = round(5 * pgx["multiplier"], 1)
        gene_label = pgx["gene"] + " (" + pgx["variant"] + ")"

        interactions.append({
            "type": "PGx",
            "drug_a": pgx["drug"],
            "drug_b": gene_label,
            "description": pgx["recommendation"],
            "score_contribution": score_contribution,
        })

    # ------------------------------------------------------------------
    # Step 5 — Compute total score (capped at 100).
    # ------------------------------------------------------------------
    total_raw = sum(item["score_contribution"] for item in interactions)
    total_score = min(100, round(total_raw))

    # ------------------------------------------------------------------
    # Step 6 — Assign overall severity band.
    # ------------------------------------------------------------------
    severity_band = _overall_severity_band(total_score)

    # ------------------------------------------------------------------
    # Step 7 — Sort by score_contribution descending and assign ranks.
    # ------------------------------------------------------------------
    interactions.sort(key=lambda x: x["score_contribution"], reverse=True)

    ranked_interactions = []
    for rank, item in enumerate(interactions, start=1):
        ranked_interactions.append({
            "rank": rank,
            "type": item["type"],
            "drug_a": item["drug_a"],
            "drug_b": item["drug_b"],
            "description": item["description"],
            "score_contribution": item["score_contribution"],
            "severity_band": _item_severity_band(item["score_contribution"]),
        })

    return {
        "total_score": total_score,
        "severity_band": severity_band,
        "interactions": ranked_interactions,
    }
