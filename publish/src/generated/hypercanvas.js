// @dfosco/hypercanvas shim for published prototypes (read-only).
import { createContext, createElement, useContext, useState } from 'react'
import data from './data.js'

export const PrototypeContext = createContext(null)
export function PrototypeProvider({ prototypeName, children }) {
  return createElement(PrototypeContext.Provider, { value: prototypeName || null }, children)
}

function scopedName(collection, scope, name) {
  const scoped = scope ? `${scope}/${name}` : name
  return Object.hasOwn(collection, scoped) ? scoped : name
}

function deepMerge(target, source) {
  const result = { ...target }
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    result[key] = value && current && typeof value === "object" && typeof current === "object" && !Array.isArray(value) && !Array.isArray(current)
      ? deepMerge(current, value) : value
  }
  return result
}

function resolveRefs(value, scope, seen = new Set()) {
  if (value == null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, scope, seen))
  if (typeof value.$ref === "string") {
    const name = scopedName(data.objects, scope, value.$ref)
    if (seen.has(name)) throw new Error(`Circular $ref detected: ${value.$ref}`)
    const referenced = data.objects[name]
    if (referenced == null) throw new Error(`Data object not found: ${name}`)
    const next = new Set(seen); next.add(name)
    return resolveRefs(referenced, scope, next)
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child, scope, seen)]))
}

function flowData(scope) {
  const key = scopedName(data.flows, scope, "default")
  const flow = structuredClone(data.flows[key] || {})
  if (Array.isArray(flow.$global)) {
    const names = flow.$global; delete flow.$global
    let globals = {}
    for (const name of names) {
      const resolvedName = scopedName(data.objects, scope, name)
      if (data.objects[resolvedName] != null) globals = deepMerge(globals, resolveRefs(data.objects[resolvedName], scope))
    }
    Object.assign(flow, deepMerge(globals, flow))
  }
  return resolveRefs(flow, scope)
}

function getByPath(value, path) {
  return path ? String(path).split(".").reduce((current, key) => current?.[key], value) : value
}

export function useFlowData(path) {
  const scope = useContext(PrototypeContext)
  const value = flowData(scope)
  return path ? getByPath(value, path) ?? {} : value
}

export function useObject(name, path) {
  const scope = useContext(PrototypeContext)
  const key = scopedName(data.objects, scope, name)
  const value = data.objects[key] == null ? undefined : resolveRefs(data.objects[key], scope)
  return path && value != null ? getByPath(value, path) : value
}

export function useRecords(name) {
  const scope = useContext(PrototypeContext)
  const key = scopedName(data.records, scope, name)
  return structuredClone(data.records[key] || [])
}

export function useRecord(name, paramName = "id") {
  const records = useRecords(name)
  const id = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) || "")
  return records.find((record) => String(record?.[paramName]) === id) ?? null
}

export function useFlowLoading() { return false }
export const useSceneData = useFlowData
export const useSceneLoading = useFlowLoading
export function useKnob() { return undefined }
export function useOverride(_path, defaultValue) {
  const [value, setValue] = useState(defaultValue)
  return [value, setValue, () => setValue(defaultValue)]
}
