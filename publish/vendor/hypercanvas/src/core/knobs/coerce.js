/**
 * Knob value coercion.
 *
 * Turns URL hash strings into typed values according to a KnobDef while
 * tolerating malformed input so prototypes can fall back to defaults.
 */

function warnInvalid(rawValue, def, reason) {
  if (import.meta.env?.DEV) {
    console.warn(
      `[storyboard-knobs] Could not coerce knob "${def?.id || 'unknown'}" value "${rawValue}": ${reason}`,
    )
  }
}

function optionValue(option) {
  if (option && typeof option === 'object' && 'value' in option) return option.value
  return option
}

function isIsoDate(rawValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return false
  const [year, month, day] = rawValue.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
}

function coerceStringArray(rawValue, def) {
  let parsed
  try {
    parsed = JSON.parse(rawValue)
  } catch (err) {
    warnInvalid(rawValue, def, err.message)
    return undefined
  }

  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    return undefined
  }

  if (def?.itemType === 'number') {
    const numbers = parsed.map(item => Number(item))
    return numbers.some(Number.isNaN) ? undefined : numbers
  }

  return parsed
}

/**
 * Coerce a raw URL hash string into a typed knob value.
 *
 * @param {string|undefined|null} rawValue
 * @param {object} def
 * @returns {*|undefined}
 */
export function coerceByType(rawValue, def = {}) {
  if (rawValue == null) return undefined

  switch (def?.type) {
    case 'text':
    case 'textarea':
      return rawValue
    case 'number':
    case 'slider': {
      const value = Number(rawValue)
      return Number.isNaN(value) ? undefined : value
    }
    case 'boolean':
      if (rawValue === 'true') return true
      if (rawValue === 'false') return false
      return undefined
    case 'select':
    case 'radio': {
      const options = Array.isArray(def?.options) ? def.options.map(optionValue) : []
      return options.includes(rawValue) ? rawValue : undefined
    }
    case 'range': {
      const [min, max, ...rest] = String(rawValue).split(',')
      if (rest.length > 0 || min === undefined || max === undefined) return undefined
      const values = [Number(min), Number(max)]
      return values.some(Number.isNaN) ? undefined : values
    }
    case 'date':
      return isIsoDate(rawValue) ? rawValue : undefined
    case 'string-array':
      return coerceStringArray(rawValue, def)
    case 'object':
    default:
      return undefined
  }
}
