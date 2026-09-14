import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";

export default function Setup() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Setup failed");

      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("role", data.role);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="glass-card login-card" onSubmit={handleSubmit} style={{ width: 380 }}>
        <h1>Welcome to Dispatch OPS</h1>
        <p>This is a brand-new installation. Create the Administrator account to get started - this page will never appear again after this.</p>
        <div className="field">
          <label>Admin Username</label>
          <input required value={username} onChange={(e) => setUsername(e.target.value)} autoFocus minLength={3} />
        </div>
        <div className="field">
          <label>Password (min. 8 characters)</label>
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} />
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <input required type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} />
        </div>
        <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Creating account..." : "Create Administrator Account"}
        </button>
        {error && <div className="error-text">{error}</div>}
      </form>
    </div>
  );
}
