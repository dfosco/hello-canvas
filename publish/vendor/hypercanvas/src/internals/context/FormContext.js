import { createContext } from 'react'

/**
 * Provides the form context from <StoryboardForm> to child inputs.
 *
 * Value shape:
 * {
 *   prefix: string,             // data path prefix (e.g. "checkout")
 *   getDraft: (name) => any,    // read local draft value for a field
 *   setDraft: (name, value) => void,  // write local draft value
 * }
 */
export const FormContext = createContext(null)
