import React, { useState, useEffect } from "react";
import { registerUser, loginUser } from "../api.js";
import { authStorage } from "../storage.js";

export default function AuthModal({ isOpen, initialMode = "signup", onClose, onAuthSuccess }) {
  const [mode, setMode] = useState(initialMode); // "login" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successInfo, setSuccessInfo] = useState("");

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setSuccessInfo("");
  };

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      resetForm();
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleSwitchMode = (newMode) => {
    setMode(newMode);
    setError("");
    setSuccessInfo("");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessInfo("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const inputHash = await authStorage.hashPassword(password);
      try {
        const remoteRes = await loginUser(trimmedEmail, inputHash);
        if (remoteRes && remoteRes.user) {
          authStorage.setCurrentUser(remoteRes.user);
          onAuthSuccess(remoteRes.user);
          onClose();
          return;
        }
      } catch (remoteErr) {
        // Fallback to local storage
        const localUser = authStorage.getUser(trimmedEmail);
        if (localUser && localUser.passwordHash === inputHash) {
          const userObj = { email: localUser.email, name: localUser.name || localUser.email.split("@")[0] };
          authStorage.setCurrentUser(userObj);
          onAuthSuccess(userObj);
          onClose();
          return;
        }
        setError(remoteErr.message || "Invalid email or password.");
        return;
      }
    } catch (err) {
      setError("Login failed: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessInfo("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const passwordHash = await authStorage.hashPassword(password);
      const userName = name.trim() || trimmedEmail.split("@")[0];

      // Register user in Supabase database
      const remoteRes = await registerUser(trimmedEmail, userName, passwordHash);
      const user = remoteRes.user || { email: trimmedEmail, name: userName };

      // Save locally for fast access
      authStorage.saveUser({
        email: user.email,
        name: user.name,
        passwordHash,
        createdAt: Date.now(),
      });

      // Do not auto-login; show success message and switch to login mode
      setName("");
      setPassword("");
      setConfirmPassword("");
      setMode("login");
      setSuccessInfo("Account created successfully! Please log in.");
    } catch (err) {
      setError(err.message || "Failed to create account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-overlay">
      <div className="auth-modal-card">
        <button className="auth-modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>

        <div className="auth-modal-header">
          <div className="auth-modal-icon">
            <TharikAILogo />
          </div>
          <h2>
            {mode === "login" && "Welcome back"}
            {mode === "signup" && "Create your account"}
          </h2>
          <p>
            {mode === "login" && "Sign in to access your chat history on TharikAI."}
            {mode === "signup" && "Sign up to start conversations with TharikAI."}
          </p>
        </div>

        {error && <div className="auth-alert error-alert">{error}</div>}
        {successInfo && <div className="auth-alert info-alert">{successInfo}</div>}

        {/* LOGIN FORM */}
        {mode === "login" && (
          <form className="auth-form" onSubmit={handleLogin} autoComplete="off">
            <div className="form-field">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                name="login_user_email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                name="login_user_password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? "Signing in..." : "Continue"}
            </button>

            <div className="auth-footer-text">
              Don't have an account?{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => handleSwitchMode("signup")}
              >
                Sign up
              </button>
            </div>
          </form>
        )}

        {/* SIGNUP FORM */}
        {mode === "signup" && (
          <form className="auth-form" onSubmit={handleSignup} autoComplete="off">
            <div className="form-field">
              <label htmlFor="signup-name">Full name</label>
              <input
                id="signup-name"
                name="signup_user_name"
                type="text"
                placeholder="e.g. Tharik"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="form-field">
              <label htmlFor="signup-email">Email address</label>
              <input
                id="signup-email"
                name="signup_user_email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                name="signup_user_password"
                type="password"
                placeholder="Create a password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="signup-confirm-password">Confirm Password</label>
              <input
                id="signup-confirm-password"
                name="signup_user_confirm_password"
                type="password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? "Creating account..." : "Create account"}
            </button>

            <div className="auth-footer-text">
              Already have an account?{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => handleSwitchMode("login")}
              >
                Log in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function TharikAILogo() {
  return (
    <img
      src="/logo.png"
      alt="TharikAI Logo"
      className="auth-modal-logo-img"
    />
  );
}
