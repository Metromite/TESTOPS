import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="glass-card login-card" onSubmit={handleSubmit}>
        <h1>Dispatch OPS</h1>
        <p>Sign in with your company account.</p>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        {error && <div className="error-text">{error}</div>}
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 16, marginBottom: 0 }}>
          Trouble signing in? Double-check the username/password aren't off by a
          typo or extra space. If you're truly locked out (e.g. the original
          Admin password was lost), someone with access to the server can run{" "}
          <code>reset_admin.py</code> to bring back the first-time setup page -
          this can't be done from the browser for security reasons.
        </p>
      </form>
    </div>
  );
}
