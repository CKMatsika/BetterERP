import { useState, type FormEvent } from "react";
import { Boxes } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Button, Input, Field } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in. Check the server connection.");
      setSubmitting(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <span className="logo"><Boxes size={20} /></span> BetterERP
        </div>
        {error && <div className="login-error">{error}</div>}
        <Field label="Username">
          <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="username" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </Field>
        <Button type="submit" disabled={submitting || !username || !password} style={{ width: "100%", marginTop: 6 }}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}