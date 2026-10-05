"use strict";

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port && window.location.port !== "5000"
  ? "http://localhost:5000"
  : "";

// ── Helpers ────────────────────────────────────────────────────────────────

function storeSession(data) {
  localStorage.setItem("cliniq_token",   data.token);
  localStorage.setItem("cliniq_role",    data.role);
  localStorage.setItem("cliniq_name",    data.name);
  localStorage.setItem("cliniq_user_id", data.user_id);
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideErr(id) {
  document.getElementById(id).classList.add("hidden");
}

function setLoading(btnId, loading, defaultText) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait…" : defaultText;
}

// ── Role selection ─────────────────────────────────────────────────────────

let selectedRole = "patient";

function selectRole(role) {
  selectedRole = role;
  document.getElementById("role-patient").classList.toggle("selected", role === "patient");
  document.getElementById("role-doctor").classList.toggle("selected",  role === "doctor");
}

// ── Tab switching ──────────────────────────────────────────────────────────

function showLogin() {
  document.getElementById("tab-login").classList.add("active");
  document.getElementById("tab-signup").classList.remove("active");
  document.getElementById("panel-login").classList.remove("hidden");
  document.getElementById("panel-signup").classList.add("hidden");
  hideErr("login-error");
}

function showSignup() {
  document.getElementById("tab-signup").classList.add("active");
  document.getElementById("tab-login").classList.remove("active");
  document.getElementById("panel-signup").classList.remove("hidden");
  document.getElementById("panel-login").classList.add("hidden");
  hideErr("signup-error");
}

// ── Login ──────────────────────────────────────────────────────────────────

async function doLogin() {
  hideErr("login-error");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  if (!email || !password) {
    showErr("login-error", "Please enter your email and password.");
    return;
  }

  setLoading("login-btn", true, "Sign In");
  try {
    const resp = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      showErr("login-error", data.error || "Login failed.");
      return;
    }
    storeSession(data);
    redirect(data.role);
  } catch (e) {
    showErr("login-error", "Cannot reach the server. Is the backend running?");
  } finally {
    setLoading("login-btn", false, "Sign In");
  }
}

// ── Sign-up ────────────────────────────────────────────────────────────────

async function doSignup() {
  hideErr("signup-error");
  const name     = document.getElementById("signup-name").value.trim();
  const email    = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!name || !email || !password) {
    showErr("signup-error", "Please fill in all fields.");
    return;
  }

  setLoading("signup-btn", true, "Create Account");
  try {
    const resp = await fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role: selectedRole }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      showErr("signup-error", data.error || "Sign-up failed.");
      return;
    }
    storeSession(data);
    redirect(data.role);
  } catch (e) {
    showErr("signup-error", "Cannot reach the server. Is the backend running?");
  } finally {
    setLoading("signup-btn", false, "Create Account");
  }
}

function redirect(role) {
  window.location.href = role === "doctor" ? "doctor.html" : "patient.html";
}

// ── Redirect if already logged in ──────────────────────────────────────────
(function checkExisting() {
  const token = localStorage.getItem("cliniq_token");
  const role  = localStorage.getItem("cliniq_role");
  if (token && role) redirect(role);
})();

// ── Enter-key support ──────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const loginPanel = document.getElementById("panel-login");
  if (!loginPanel.classList.contains("hidden")) doLogin();
  else doSignup();
});
