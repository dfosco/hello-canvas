import content from './generated/content.js'

export default function HomePage({ go }) {
  return (
    <main className="home">
      <h1 className="home-title">{content.title}</h1>
      <p className="home-subtitle">{content.pages.length} published page{content.pages.length === 1 ? "" : "s"}</p>
      <ul className="home-list">
        {content.pages.map((page) => (
          <li key={page.id} className="home-item">
            <a href={"./" + page.slug} onClick={(event) => go(event, page.slug)}>
              <span className="home-item-type">{page.type}</span>
              <span className="home-item-title">{page.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
