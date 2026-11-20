export default function TwoFactorRecoveryLoading() {
  return (
    <div className="auth-state" role="status" aria-live="polite">
      <span className="auth-state-icon" aria-hidden="true">
        <span className="auth-spinner auth-spinner--lg" />
      </span>
      <h1 className="auth-title">Loading recovery</h1>
      <p className="auth-desc">Preparing two-factor recovery…</p>
    </div>
  )
}
