export default function UnsubscribeLoading() {
  return (
    <main id="top" tabIndex={-1} className="page-main" aria-busy="true">
      <section className="page-hero">
        <div className="container">
          <p className="page-lede" role="status">
            Loading your unsubscribe link…
          </p>
        </div>
      </section>
    </main>
  )
}
