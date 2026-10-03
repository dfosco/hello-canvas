import { createElement } from 'react'
import { StoryboardContext } from './StoryboardContext.js'
import { init } from '../core/index.js'

// Default test data
export const TEST_FLOWS = {
  default: {
    user: { name: 'Jane', profile: { bio: 'Dev' } },
    settings: { theme: 'dark' },
    projects: [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }],
  },
  other: {
    user: { name: 'Bob' },
    settings: { theme: 'light' },
  },
}

/** @deprecated Use TEST_FLOWS */
export const TEST_SCENES = TEST_FLOWS

export const TEST_OBJECTS = {
  'jane-doe': { name: 'Jane Doe', role: 'admin' },
}

export const TEST_RECORDS = {
  posts: [
    { id: 'post-1', title: 'First Post', author: 'Jane' },
    { id: 'post-2', title: 'Second Post', author: 'Bob' },
  ],
}

export function seedTestData() {
  init({ flows: TEST_FLOWS, objects: TEST_OBJECTS, records: TEST_RECORDS })
}

// Wrapper that provides StoryboardContext with given flow data
export function createWrapper(flowData, flowName = 'default') {
  return function Wrapper({ children }) {
    return createElement(
      StoryboardContext.Provider,
      { value: { data: flowData, error: null, loading: false, flowName, sceneName: flowName } },
      children
    )
  }
}
