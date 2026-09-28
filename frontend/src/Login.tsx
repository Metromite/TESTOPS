import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "./theme/ThemeProvider";
import { loginAppUser } from "./services/appAuth";

export default function Login() {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();

  const [username, setUsername] = useState(
    localStorage.getItem("dispatchops-remembered-username") || ""
  );

  const [password, setPassword] = useState(
    ""
  );

  const [remember, setRemember] = useState(
    localStorage.getItem("dispatchops-remember-me") === "true"
  );

  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const account = await loginAppUser(username.trim(), password);
      sessionStorage.setItem("dispatchops-auth", "true");
      sessionStorage.setItem("dispatchops-role", account.role);
      sessionStorage.setItem("dispatchops-username", account.username);
      sessionStorage.setItem("dispatchops-user-id", account.id);
      window.dispatchEvent(new Event("dispatchops-auth-change"));
      if (remember) {
        localStorage.setItem("dispatchops-remembered-username", account.username);
        localStorage.setItem("dispatchops-remember-me", "true");
      } else {
        localStorage.removeItem("dispatchops-remembered-username");
        localStorage.removeItem("dispatchops-remember-me");
      }
      navigate("/", { replace: true });
    } catch (e:any) {
      setError(e?.message || "Invalid username or password.");
    }
  }

  return (
    <main className="login-page">
      <section className="login-card glass-card">
        <div className="login-brand">
          <img
            src="/app-icon.png"
            alt="Dispatch OPS"
            className="login-logo"
          />

          <div>
            <div className="login-brand-name">
              DISPATCH OPS
            </div>

            <div className="login-brand-subtitle">
              Operations Control Center
            </div>
          </div>
        </div>

        <div className="login-title">
          Sign in
        </div>

        <div className="login-subtitle">
          Enter your Dispatch OPS credentials to continue.
        </div>

        <form onSubmit={submit}>
          <label className="login-field">
            <span>Username</span>

            <input
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value)
              }
              placeholder="Username"
              autoFocus
            />
          </label>

          <label className="login-field">
            <span>Password</span>

            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="Password"
            />
          </label>

          <label className="login-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) =>
                setRemember(event.target.checked)
              }
            />

            <span>
              Remember me on this device
            </span>
          </label>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-submit"
          >
            Sign in
          </button>
        </form>

        <div className="login-footer">
          {resolvedTheme === "dark"
            ? "Dark mode"
            : "Light mode"}
        </div>
      </section>
    </main>
  );
}
