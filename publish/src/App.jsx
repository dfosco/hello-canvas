import { useEffect, useState } from 'react'
import content from './generated/content.js'
import canvases from './generated/canvases.js'
import prototypes from './generated/prototypes.jsx'
import CanvasPage from './CanvasPage.jsx'
import PrototypePage from './PrototypePage.jsx'
import NotFoundPage from './NotFoundPage.jsx'
import HomePage from './HomePage.jsx'

// Restore the route after a GitHub Pages 404.html redirect (?p=…&b=…).
function initialRoute() {
  const params = new URLSearchParams(window.location.search)
  const p = params.get('p')
  const b = params.get('b')
  if (p !== null && b !== null) {
    const slug = p.replace(/^\/+/, '').replace(/\/+$/, '')
    const base = b.replace(/\/+$/, '')
    window.history.replaceState(null, '', (slug ? base + '/' + slug : base) + window.location.hash)
    return slug
  }
  return currentRoute()
}

function currentRoute() {
  const segments = window.location.pathname.replace(/\/+$/, '').split('/')
  const last = segments[segments.length - 1] || ""
  return /\.(html?)$/i.test(last) || !content.pages.some((page) => page.slug === last) ? "" : last
}

function titleFor(route) {
  const page = content.pages.find((item) => item.slug === route)
  return page && page.title ? page.title + ' — ' + content.title : content.title
}

export default function App() {
  const [route, setRoute] = useState(initialRoute)

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => { document.title = titleFor(route) }, [route])

  function go(event, slug) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    window.history.pushState(null, '', slug ? './' + slug : './')
    setRoute(slug)
  }

  const page = content.pages.find((item) => item.slug === route)
  return (
    <div className="shell">
      <header className="shell-header">
        <a className="shell-title" href="./" onClick={(event) => go(event, "")}>{content.title}</a>
        <span className="shell-badge">Read-only published presentation</span>
      </header>
      {route === "" ? <HomePage go={go} /> : null}
      {route !== "" && page && page.type === "canvas"
        ? <CanvasPage page={page} state={canvases[page.id] ?? null} />
        : null}
      {route !== "" && page && page.type === "prototype"
        ? <PrototypePage page={page} Component={prototypes[page.id] ?? null} />
        : null}
      {route !== "" && !page ? <NotFoundPage go={go} /> : null}
      <footer className="shell-footer">Published with Hypercanvas</footer>
    </div>
  )
}
