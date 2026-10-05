# Clin.IQ — Clinical Intelligence & DDI Risk Engine

Clin.IQ is an intelligent clinical decision support system designed to evaluate adverse Drug-Drug Interactions (DDIs) for complex polypharmacy patients. By synthesizing multi-dimensional clinical inputs—live pharmacology data, patient comorbidities, and pharmacogenomics (PGx)—Clin.IQ delivers ranked, color-coded risk stratifications at the point of care.

---

## 🚀 Key Features

- **Multi-Dimensional Risk Scoring:** Evaluates interaction severity by combining DDI pharmacology, chronic comorbidity risk multipliers, and patient CPIC genetic profiles.
- **Real-Time Clinician Dashboard:** Interactive interface for healthcare professionals to review patient medication regimens, simulate drug additions, and review contraindications.
- **Pharmacogenomics (PGx) Integration:** Identifies gene-drug anomalies (e.g., CYP2C19, CYP2D6, SLCO1B1) with clinical recommendations.
- **Patient Portal:** Empowering patients to view medication schedules, personalized safety alerts, and risk summaries.
- **Lightweight Architecture:** Powered by a Python Flask REST backend and responsive vanilla frontend.

---

## 🛠️ Tech Stack

- **Backend:** Python 3, Flask, SQLite / JSON data stores, OpenFDA API integration
- **Frontend:** Vanilla HTML5, CSS3 (Modern Glassmorphism & Responsive Design), JavaScript (ES6+)
- **Data Standards:** CPIC guideline data, Charlson/custom comorbidity weighting models

---

## 📦 Getting Started

### Prerequisites

- Python 3.10+
- pip

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Debopriyo26/Clin.IQ.git
   cd Clin.IQ
   ```

2. **Set up the backend:**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. **Run the application:**
   ```bash
   python app.py
   ```

4. **Access the application:**
   - Clinician Portal: `http://localhost:5000/doctor.html`
   - Patient View: `http://localhost:5000/patient.html`
