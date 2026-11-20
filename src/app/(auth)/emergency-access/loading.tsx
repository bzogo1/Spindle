export default function EmergencyAccessLoading() {
  return (
    <div className="auth-state" role="status" aria-live="polite">
      <span className="auth-state-icon" aria-hidden="true">
        <span className="auth-spinner auth-spinner--lg" />
      </span>
      <h1 className="auth-title">Loading emergency access</h1>
      <p className="auth-desc">Preparing your recovery options…</p>
    </div>
  )
}
