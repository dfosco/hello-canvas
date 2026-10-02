/**
 * GlobalNavigation component stories.
 * Showcases the GitHub-style repository header with underline nav tabs.
 */
import GlobalNavigation from './GlobalNavigation.jsx'

export function Default() {
  return <GlobalNavigation title="octocat" subtitle="hello-world" />
}

export function TitleOnly() {
  return <GlobalNavigation title="github" />
}
