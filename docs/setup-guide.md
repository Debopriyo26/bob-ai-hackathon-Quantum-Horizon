# Setup & Execution Guide: Clin.IQ

This guide provides step-by-step instructions to set up, configure, and execute the **Clin.IQ** platform locally from source.

---

## Prerequisites

Before setting up the project, ensure your workstation meets the following minimum requirements:

- **Python:** Python 3.10, 3.11, or 3.12 installed
- **Package Manager:** `pip` (Python package installer)
- **Version Control:** Git installed
- **Web Browser:** Modern web browser (Google Chrome, Mozilla Firefox, Microsoft Edge, or Safari)
- **Network Access:** Optional internet access for external RxNav lookups (a comprehensive local rule base is included offline)

---

## Repository & Environment Configuration

### 1. Clone the Official Repository

```bash
git clone https://github.com/Debopriyo26/bob-ai-hackathon-Quantum-Horizon.git
cd bob-ai-hackathon-Quantum-Horizon
```

### 2. Navigate to the Source Directory

All application execution commands are designed to run directly from the `src/` directory:

```bash
cd src
```

### 3. (Optional but Recommended) Create a Virtual Environment

Isolate project dependencies by creating a dedicated Python virtual environment:

**On macOS / Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**On Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**On Windows (Command Prompt):**
```cmd
python -m venv venv
.\venv\Scripts\activate.bat
```

### 4. Install Dependencies

Install all required Python packages using `requirements.txt`:

```bash
pip install -r requirements.txt
```

Verified dependencies installed:
- `flask>=3.0.0`: Lightweight REST API and web application server.
- `flask-cors>=4.0.0`: Secure Cross-Origin Resource Sharing handling.
- `requests>=2.31.0`: HTTP client for pharmaceutical API interactions.
- `gunicorn>=21.2.0`: Production-ready WSGI HTTP server (for cloud deployments).

### 5. Configure Environment Variables

Create your local `.env` configuration file from the provided template:

**On macOS / Linux:**
```bash
cp .env.example .env
```

**On Windows:**
```cmd
copy .env.example .env
```

The application defaults work out of the box using local SQLite storage without requiring any paid cloud API keys.

---

## Running the Application Locally

Run the application directly from inside the `src/` directory:

```bash
python app.py
```

*Alternative command:*
```bash
python backend/app.py
```

### Expected Terminal Output

```
Starting Clin.IQ on http://localhost:5000 ...
 * Serving Flask app 'backend.app'
 * Debug mode: off
 * Running on all addresses (0.0.0.0)
 * Running on http://127.0.0.1:5000
 * Running on http://localhost:5000
Press CTRL+C to quit
```

Open your browser and navigate to:
```
http://localhost:5000
```
This automatically redirects you to the Clin.IQ authentication gateway (`http://localhost:5000/auth.html`).

---

## Demo Accounts & Walkthrough

The SQLite database (`backend/data/cliniq.db`) is automatically initialized on the first launch with pre-seeded demo personas:

### 1. Clinician Demo Account
- **Role:** Doctor
- **Email:** `doctor@cliniq.demo`
- **Password:** `demo1234`
- **Features to explore:**
  - View pre-loaded complex polypharmacy patient (James Harrington, 68 yo).
  - Observe the animated Multi-Factor Risk Gauge (Composite Score ~74 High Risk).
  - Inspect the Drug-Drug Interaction severity matrix (e.g., Warfarin + Aspirin severe bleeding hazard).
  - Review CPIC Pharmacogenomic alerts (CYP2C19 poor metabolizer warning).
  - Add or remove medications (e.g., test adding Ibuprofen to observe acute comorbidity contraindication with CKD).
  - Click **"View Safer Prescribing Alternative"** to test one-click drug replacement.

### 2. Patient Demo Account
- **Role:** Patient
- **Email:** `patient@cliniq.demo`
- **Password:** `demo1234`
- **Features to explore:**
  - View clear, accessible plain-language medication explanations.
  - Review the daily intake schedule timeline (Morning, Afternoon, Evening).
  - Check personalized cautionary warnings and food interaction instructions.

### 3. New User Registration
You can also register a brand new Doctor or Patient account at any time directly through the "Sign Up" tab on the authentication portal.

---

## Running Automated Health Checks

You can verify the backend REST endpoints and clinical scoring engine using curl or PowerShell:

```bash
# Health check / Risk evaluation test
curl -X POST http://localhost:5000/api/assess-risk \
  -H "Content-Type: application/json" \
  -d '{"medications":["warfarin","aspirin"],"comorbidities":["peptic_ulcer"],"pgx_profile":{"CYP2C19":"*2/*2"}}'
```

---

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `Address already in use` (Port 5000 conflict) | Another process or AirPlay receiver is listening on port 5000 | Terminate the process using port 5000, or edit `PORT=5001` in `.env` and `app.py`. |
| `ModuleNotFoundError: No module named 'flask'` | Virtual environment not active or dependencies not installed | Run `pip install -r requirements.txt` inside your active virtual environment. |
| `sqlite3.OperationalError: unable to open database file` | Missing write permissions in `src/backend/data/` | Ensure your user has write permissions in the repository folder. The database file `cliniq.db` will be created automatically. |
| Browser shows static page without live data | JavaScript disabled or cached static assets | Perform a hard refresh (`Ctrl + F5` or `Cmd + Shift + R`) to reload updated JS bundles. |
