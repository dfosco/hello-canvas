import SitePage from '@dfosco/hypercanvas/site-page'

export default function Sites() {
  return <SitePage basePath={import.meta.env.BASE_URL} />
}
