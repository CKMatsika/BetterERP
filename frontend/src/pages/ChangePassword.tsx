import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Button, Field, Input } from "../components/ui";

export default function ChangePassword() {
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("The new password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("The new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to change password.");
      setSaving(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">Change your password</div>
        <p className="muted">{user?.fullName}, your account requires a new password before you continue.</p>
        {error && <div className="login-error">{error}</div>}
        <Field label="Current password"><Input type="password" autoFocus value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password"><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm new password"><Input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" /></Field>
        <Button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmation} style={{ width: "100%", marginTop: 6 }}>{saving ? "Updating…" : "Update password"}</Button>
        <Button type="button" variant="ghost" onClick={() => void logout()} style={{ width: "100%", marginTop: 6 }}>Sign out</Button>
      </form>
    </div>
  );
}
