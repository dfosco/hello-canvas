import { PrototypeProvider } from './generated/hypercanvas.js'

export default function PrototypePage({ page, Component }) {
  return (
    <main className="page">
      <div className="page-heading">
        <h1>{page.title}</h1>
        <span className="page-type">Prototype</span>
      </div>
      <div className="prototype-surface">
        <PrototypeProvider prototypeName={page.prototypeName}>
          {Component ? <Component /> : <p className="page-unavailable">Prototype entry point is unavailable.</p>}
        </PrototypeProvider>
      </div>
    </main>
  )
}
