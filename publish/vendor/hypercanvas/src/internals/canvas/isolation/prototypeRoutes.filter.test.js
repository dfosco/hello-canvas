import { describe, it, expect } from 'vitest'
import { filterChildrenForProto } from './routeFilter.js'

// Shape mirrors what generouted's generateRegularRoutes produces: nested
// sub-routes live as children of the prototype's top-level path node.
//   src/prototypes/canvas-threats/index.jsx   -> { path: 'canvas-threats', children: [{ index: true }, ...] }
//   src/prototypes/canvas-threats/threats.jsx -> a { path: 'threats' } child of 'canvas-threats'
const nestedTree = () => [
  {
    path: 'canvas-threats',
    children: [
      { index: true, id: 'index' },
      { path: 'threats', id: 'threats' },
      { path: 'detail/:id', id: 'detail' },
    ],
  },
  { path: 'other-proto', children: [{ index: true, id: 'other' }] },
  { path: '*', id: 'fallback' },
]

describe('filterChildrenForProto', () => {
  it('keeps nested sub-routes of the matched prototype (regression: nested scoped routes)', () => {
    const out = filterChildrenForProto(nestedTree(), 'canvas-threats')
    const proto = out.find((r) => r.path === 'canvas-threats')
    expect(proto).toBeTruthy()
    // The nested `threats` child must survive — this was the bug.
    expect(proto.children.map((c) => c.id)).toEqual(['index', 'threats', 'detail'])
  })

  it('drops sibling prototypes but keeps the splat fallback', () => {
    const out = filterChildrenForProto(nestedTree(), 'canvas-threats')
    expect(out.find((r) => r.path === 'other-proto')).toBeUndefined()
    expect(out.find((r) => r.path === '*')).toBeTruthy()
  })

  it('descends through pathless layout wrappers to reach prototype routes', () => {
    const wrapped = [
      { Component: () => null, children: nestedTree() },
      { path: '*', id: 'fallback' },
    ]
    const out = filterChildrenForProto(wrapped, 'canvas-threats')
    const layout = out.find((r) => !r.path && r.children)
    const proto = layout.children.find((r) => r.path === 'canvas-threats')
    expect(proto.children.map((c) => c.id)).toEqual(['index', 'threats', 'detail'])
    expect(layout.children.find((r) => r.path === 'other-proto')).toBeUndefined()
  })
})
