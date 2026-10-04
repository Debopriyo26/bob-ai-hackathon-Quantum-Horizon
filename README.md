# 🚀 Clin.IQ — Clinical Decision Support Platform

An intelligent, dual-role (Doctor/Patient) clinical decision support platform that evaluates complex polypharmacy regimens using a local rule-based AI engine to generate instant risk scores, clinical insights, and safer prescribing alternatives.

---

## 👥 Team

| Field | Value |
|---|---|
| **Team Name** | Quantum Horizon |
| **Track** | AI |
| **Team Lead** | Debopriyo Bagchi — bagchi07debopriyo@gmail.com |
| **Members** | Arnob Chaudhuri, Shafik Hawawala, Rudra Joshi, Yashsh Gajjar, Heet Jain |

---

## 🎯 Problem Statement

Clinicians lack the time to manually cross-reference complex drug-drug interactions, patient comorbidities, and pharmacogenomic data during time-pressured appointments, leading to a high risk of adverse drug events.

---

## 💡 Solution

Clin.IQ is a dual-role (Doctor/Patient) clinical decision support platform that evaluates polypharmacy regimens using a local rule-based AI engine to generate instant risk scores, clinical insights, and safer prescribing alternatives.

---

## ✨ Key Features

- **Multi-Factor Polypharmacy Risk Engine:** Deterministic rule-based evaluation incorporating Drug-Drug Interactions (DDI), Comorbidity Contraindications, and Pharmacogenomic (PGx CPIC) risk factors.
- **Dual-Role Clinical Experience:** Tailored workflows for Clinicians (deep pharmacology, interaction severity matrix, alternative suggestions) and Patients (accessible medication schedules and plain-language guidance).
- **Local NLP Clinical Co-Pilot:** Rapid offline natural language processing for clinical notes, symptom correlation, and decision support without cloud latency.
- **Automated Safer Prescribing Alternatives:** Context-aware medication substitution recommendations that propose safer drugs with lower interaction scores.
- **Interactive Risk Stratification & Visual Analytics:** Real-time risk dials, breakdown charts, and interaction severity matrices for quick clinical decision-making.

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | Python, JavaScript (ES6+), HTML5, CSS3 |
| **Frameworks** | Flask, Flask-CORS |
| **IBM Technologies** | watsonx.ai, IBM Bob AI |
| **Databases** | SQLite |
| **Other** | Local NLP, RxNav REST API, Gunicorn |

---

## 📁 Repository Structure

```
├── src/                  # All source code (Flask backend & Vanilla HTML/CSS/JS frontend)
│   ├── backend/          # Flask app, scoring engines, DDI/PGx/comorbidity modules, SQLite DB
│   ├── frontend/         # Doctor & Patient portals, interactive dashboards, styles
│   ├── app.py            # Primary application entrypoint
│   ├── requirements.txt  # Python package dependencies
│   └── .env.example      # Environment variable configuration template
├── docs/                 # Written documentation
│   ├── problem-statement.md
│   ├── solution-overview.md
│   ├── architecture.md
│   └── setup-guide.md
├── demo/                 # Demo artifacts
│   ├── screenshots/      # App UI screenshots
│   ├── live-demo-url.txt # Live deployment link
│   └── demo-video-link.txt  # Link to demo video
├── presentation/         # Slide deck
└── submission.yaml       # Structured submission metadata
```

---

## ⚡ How to Run

> For detailed instructions, prerequisites, and troubleshooting, refer to [`docs/setup-guide.md`](docs/setup-guide.md).

```bash
# 1. Clone the repo
git clone https://github.com/Debopriyo26/bob-ai-hackathon-Quantum-Horizon.git
cd bob-ai-hackathon-Quantum-Horizon/src

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env

# 4. Run the project
python app.py
```

Access the application in your browser at `http://localhost:5000`.

---

## 🖥️ Demo

| Artifact | Link |
|---|---|
| 📹 Demo Video | [See demo/demo-video-link.txt](demo/demo-video-link.txt) |
| 🌐 Live Demo | [https://clin-iq.onrender.com/](https://clin-iq.onrender.com/) |
| 🖼️ Screenshots | [See demo/screenshots/](demo/screenshots/) |
| 📊 Presentation | [See presentation/](presentation/) |

---

## ⚠️ Known Limitations

- **Scope of Rule Base:** The current rules and pharmacogenomic lookups prioritize high-risk medication classes (cardiovascular, neuropsychiatric, NSAIDs, anticoagulants, metabolic agents) and CPIC Level A/B guidelines.
- **Authentication Model:** The hackathon implementation uses tokenized local session authentication designed for immediate demonstration rather than multi-tenant enterprise hospital SSO/OAuth2.

---

## 🏅 What We're Most Proud Of

Developing a deterministic, local-first clinical decision support engine that operates with zero cloud latency, cross-referencing complex Drug-Drug Interactions, CPIC pharmacogenomic guidelines, and patient comorbidity weights while simultaneously generating actionable safer prescribing alternatives and dual doctor/patient tailored interfaces.

---
