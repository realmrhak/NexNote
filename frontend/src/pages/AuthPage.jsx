import { useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import "../styles/auth.css";

export default function AuthPage({ dark, toggleDark }) {
  const { login, register } = useAuth();
  const [tab, setTab] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    if (!email || !pass || (tab === "signup" && !name)) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      if (tab === "signup") {
        await register({ name, email, password: pass });
        toast.success("Account created successfully!");
      } else {
        await login({ email, password: pass });
        toast.success("Welcome back!");
      }
    } catch (err) {
      console.error("Auth error:", err);

      // FIX: Surface SPECIFIC validation errors to the user. The backend
      // returns `{ success: false, message: "Validation failed", errors:
      // [{field, message}, ...] }` for 422 responses. Previously we only
      // read `data.message` (which was just "Validation failed") and the
      // user had no idea WHICH field failed or WHY. Now we join the
      // per-field messages into a single readable string.
      let msg;
      const status = err.response?.status;
      const backendMsg = err.response?.data?.message || err.response?.data?.error;
      const validationErrors = err.response?.data?.errors;

      if (status === 422 && Array.isArray(validationErrors) && validationErrors.length) {
        // Join all per-field validation messages into one readable line.
        // Example: "Password must be at least 8 characters, Password must
        // contain at least one number"
        msg = validationErrors.map(e => e.message).filter(Boolean).join(", ");
      } else if (status === 429) {
        // AUTH FIX #1: Rate-limited. Tell the user to wait — the backend
        // already sets a Retry-After header; we surface a friendlier message.
        const retryAfter = err.response.headers?.["retry-after"];
        msg = retryAfter
          ? `Too many attempts — please try again in ${Math.ceil(parseInt(retryAfter, 10) / 60)} minute(s).`
          : "Too many attempts — please wait a few minutes before trying again.";
      } else if (status === 401) {
        // AUTH FIX #1: Bad credentials. The backend returns a generic
        // "Invalid credentials" message; we make it more conversational.
        msg = tab === "login"
          ? "Email or password is incorrect."
          : "Could not create account with those details.";
      } else if (status === 403) {
        msg = backendMsg || "You don't have permission to do this.";
      } else if (status === 409) {
        // Duplicate email — backend returns the specific message already.
        msg = backendMsg || "An account with this email already exists.";
      } else if (status === 503) {
        // AUTH FIX #2: Render sometimes returns 503 while warming up.
        msg = "Server is starting up — please wait 30 seconds and try again.";
      } else if (err.code === "ERR_NETWORK" || err.code === "ECONNABORTED" || !err.response) {
        // AUTH FIX #2: Network error — most likely the Render free-tier
        // server is cold-starting (50-90s). Don't dump a scary axios URL.
        msg = "Cannot reach the server. It may be waking up — please wait 30 seconds and try again.";
      } else if (err.response) {
        msg = backendMsg || `Server error (${status}). Please try again.`;
      } else {
        msg = err.message || "Something went wrong. Please try again.";
      }

      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <button className="auth-theme-btn" onClick={toggleDark}>{dark ? "☀️" : "🌙"}</button>

      <div className="auth-logo">
        <h1>Nex<span>Note</span></h1>
        <p>Your notes, everywhere.</p>
      </div>

      <div className="auth-card">
        <div className="auth-tabs">
          {["login", "signup"].map(t => (
            <button
              key={t}
              className={`auth-tab ${tab === t ? "active" : ""}`}
              onClick={() => { setTab(t); setError(""); }}
            >
              {t === "login" ? "Log In" : "Sign Up"}
            </button>
          ))}
        </div>

        <div className="auth-form">
          {tab === "signup" && (
            <div className="auth-field">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
          )}
          <div className="auth-field">
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" />
          </div>
          <div className="auth-field">
            <label>Password</label>
            <div className="auth-password-wrapper">
              <input
                value={pass} onChange={e => setPass(e.target.value)}
                placeholder={tab === "signup" ? "Min 8 chars, 1 letter + 1 number" : "••••••••"}
                type={showPass ? "text" : "password"}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="auth-password-input"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPass(s => !s)}
                tabIndex={-1}
                aria-label={showPass ? "Hide password" : "Show password"}
              >
                {showPass ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            {tab === "signup" && (
              <span className="auth-field-hint">At least 8 characters with 1 letter and 1 number.</span>
            )}
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit-btn" onClick={handleSubmit} disabled={loading}>
            {loading ? "Please wait..." : tab === "login" ? "Log In" : "Create Account"}
          </button>

          <p className="auth-forgot">Forgot password?</p>
        </div>
      </div>

      <p className="auth-footer">NexNote © 2025</p>
    </div>
  );
}
