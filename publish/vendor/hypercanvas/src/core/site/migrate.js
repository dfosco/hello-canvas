import { normalizeSiteDescriptor } from './site.js'

export function migrateWorktopProject(project = {}) {
  const deployments = project.deployments ?? (project.productionBaseUrl ? { production: { baseUrl: project.productionBaseUrl } } : {})
  const site = normalizeSiteDescriptor({ id: project.id, title: project.title, deployments, defaultDeployment: project.defaultDeployment, capture: project.capture })
  return {
    site,
    binding: null,
    warnings: ['Machine-local Worktop bindings are not migrated; reconnect the Site on this machine.'],
  }
}

export function migrateWorktopFrameProps(props = {}) {
  if (!props.projectId) return { ...props }
  const rest = { ...props }
  delete rest.projectId
  delete rest.developmentBaseUrl
  const projectId = props.projectId
  return { ...rest, siteId: projectId, route: rest.route ?? '' }
}
