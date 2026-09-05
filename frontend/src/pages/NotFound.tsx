import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="empty-state">
      <h2 style={{ marginTop: 0 }}>Page not found</h2>
      <Link to="/dashboard">Back to dashboard</Link>
    </div>
  );
}