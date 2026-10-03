import http from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { createSitePreviewMiddleware } from './proxy.js'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

async function setup({ base = '/', upstreamPath = '/', authorizeRequest = () => true } = {}) {
  const upstreamRequests = []
  const upstreamCookies = []
  const upstream = http.createServer((req, res) => {
    upstreamRequests.push({ method: req.method, url: req.url })
    upstreamCookies.push(req.headers.cookie || null)
    if (req.url.endsWith('/redirect')) {
      res.writeHead(302, { Location: '/explore?from=redirect' })
      res.end()
      return
    }
    if (req.url === '/cookie') res.setHeader('Set-Cookie', 'site_session=site-token; Path=/; HttpOnly; SameSite=Lax')
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(`${req.method} ${req.url}`)
  })
  const upstreamOrigin = await listen(upstream)
  const middleware = createSitePreviewMiddleware({
    base,
    authorizeRequest,
    getDevelopmentBaseUrl: () => `${upstreamOrigin}${upstreamPath}`,
  })
  const frontend = http.createServer((req, res) => middleware(req, res, () => {
    res.writeHead(404)
    res.end('not found')
  }))
  const frontendOrigin = await listen(frontend)
  return { frontendOrigin, upstreamRequests, upstreamCookies }
}

it('serves a branch-prefixed deep Site route through its configured upstream base path', async () => {
  const { frontendOrigin, upstreamRequests } = await setup({ base: '/branch--feature/', upstreamPath: '/app/' })
  const response = await fetch(`${frontendOrigin}/branch--feature/_storyboard/site/filesystem-design/preview/explore?mode=full`)

  expect(response.status).toBe(200)
  expect(await response.text()).toBe('GET /app/explore?mode=full')
  expect(upstreamRequests).toEqual([{ method: 'GET', url: '/app/explore?mode=full' }])
})

it('redirects root-relative Site document navigation back under the preview route', async () => {
  const { frontendOrigin } = await setup({ base: '/branch--feature/', upstreamPath: '/app/' })
  const response = await new Promise((resolve, reject) => {
    const request = http.get(`${frontendOrigin}/explore?tab=all`, {
      headers: {
        referer: `${frontendOrigin}/branch--feature/_storyboard/site/filesystem-design/preview/`,
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      },
    }, result => {
      result.resume()
      resolve(result)
    })
    request.once('error', reject)
  })

  expect(response.statusCode).toBe(302)
  expect(response.headers.location).toBe('/branch--feature/_storyboard/site/filesystem-design/preview/explore?tab=all')
})

it('rewrites upstream redirects to a Core Site route', async () => {
  const { frontendOrigin } = await setup({ upstreamPath: '/app/' })
  const response = await fetch(`${frontendOrigin}/_storyboard/site/filesystem-design/preview/redirect`, { redirect: 'manual' })

  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toBe('/_storyboard/site/filesystem-design/preview/explore?from=redirect')
})

it('proxies root-relative Site assets based on the preview referrer', async () => {
  const { frontendOrigin, upstreamRequests } = await setup({ base: '/branch--feature/' })
  const response = await fetch(`${frontendOrigin}/branch--feature/assets/main.js`, {
    headers: { referer: `${frontendOrigin}/branch--feature/_storyboard/site/filesystem-design/preview/explore` },
  })

  expect(response.status).toBe(200)
  expect(response.url).toBe(`${frontendOrigin}/branch--feature/_storyboard/site/filesystem-design/asset/assets/main.js`)
  expect(await response.text()).toBe('GET /assets/main.js')
  expect(upstreamRequests).toEqual([{ method: 'GET', url: '/assets/main.js' }])
})

it('proxies relative Site assets that resolve outside the preview path, including branch base paths', async () => {
  const { frontendOrigin, upstreamRequests } = await setup({ base: '/branch--feature/', upstreamPath: '/app/' })
  const previewUrl = `${frontendOrigin}/branch--feature/_storyboard/site/filesystem-design/preview/`
  const assetUrl = new URL('../assets/images/GOOSE-IT.png', previewUrl)

  expect(assetUrl.pathname).toBe('/branch--feature/_storyboard/site/filesystem-design/assets/images/GOOSE-IT.png')

  const response = await fetch(assetUrl, { headers: { referer: previewUrl } })

  expect(response.status).toBe(200)
  expect(response.url).toBe(assetUrl.href)
  expect(await response.text()).toBe('GET /assets/images/GOOSE-IT.png')
  expect(upstreamRequests).toEqual([{ method: 'GET', url: '/assets/images/GOOSE-IT.png' }])
})

it('does not serve Site preview content without an authenticated Core session', async () => {
  const { frontendOrigin, upstreamRequests } = await setup({ authorizeRequest: () => false })
  const response = await fetch(`${frontendOrigin}/_storyboard/site/filesystem-design/preview/`)

  expect(response.status).toBe(401)
  expect(upstreamRequests).toEqual([])
})

it('scopes Site cookies to its preview and never forwards the Core session cookie', async () => {
  const { frontendOrigin, upstreamCookies } = await setup({ base: '/branch--feature/' })
  const response = await fetch(`${frontendOrigin}/branch--feature/_storyboard/site/filesystem-design/preview/cookie`, {
    headers: { cookie: 'hc_session=core-secret; site_session=site-token' },
  })

  expect(response.headers.get('set-cookie')).toContain('Path=/branch--feature/_storyboard/site/filesystem-design/')
  expect(upstreamCookies).toEqual(['site_session=site-token'])
})
