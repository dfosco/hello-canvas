import content from './generated/content.js'

export default function NotFoundPage({ go }) {
  return (
    <main className="page">
      <h1>Page not found</h1>
      <p className="page-unavailable">This published page does not exist.</p>
      <a className="home-link" href="./" onClick={(event) => go(event, "")}>Back to {content.title}</a>
    </main>
  )
}
