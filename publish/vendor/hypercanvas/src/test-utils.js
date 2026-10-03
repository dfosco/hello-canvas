import React from 'react'
import { init } from './core/index.js'
import { StoryboardContext } from './internals/StoryboardContext.js'

export const TEST_FLOWS = {
  default: {
    user: { name: 'Alice', role: 'admin' },
    settings: { theme: 'dark_dimmed', notifications: true },
    record: {
      posts: {
        'post-1': { title: 'Original Title' },
      },
    },
  },
}

/** @deprecated Use TEST_FLOWS */
export const TEST_SCENES = TEST_FLOWS

export const TEST_RECORDS = {
  posts: [
    { id: 'post-1', title: 'First Post', author: 'Alice' },
    { id: 'post-2', title: 'Second Post', author: 'Bob' },
  ],
}

export const TEST_OBJECTS = {
  navigation: { items: [{ label: 'Home', href: '/' }] },
  'jane-doe': { name: 'Jane Doe', role: 'admin', profile: { bio: 'Engineer', location: 'SF' } },
}

export function seedTestData() {
  init({ flows: TEST_FLOWS, objects: TEST_OBJECTS, records: TEST_RECORDS })
}

export function createWrapper(flowData, flowName = 'default') {
  return function Wrapper({ children }) {
    return React.createElement(
      StoryboardContext.Provider,
      { value: { data: flowData, flowName, sceneName: flowName } },
      children,
    )
  }
}
