/**
 * SearchableList — a filterable list with an auto-focused search input.
 *
 * Designed to work inside dropdown menus and popovers. Prevents printable-key
 * events from bubbling so host menus (e.g. Radix typeahead) don't hijack input.
 * Navigation keys (arrows, escape, tab) still bubble for menu keyboard nav.
 *
 * Usage:
 *   <SearchableList
 *     items={items}
 *     filterFn={(item, query) => item.name.toLowerCase().includes(query)}
 *     renderItem={(item) => <MenuItem key={item.id}>{item.name}</MenuItem>}
 *     placeholder="Filter…"
 *   />
 */
import { useState, useRef, useEffect, useMemo, useCallback, forwardRef } from 'react'
import { Input } from './input/index.js'
import { cn } from '../../utils/index.js'

/** Keys that should always bubble to the parent menu for navigation. */
const PASSTHROUGH_KEYS = new Set([
  'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'Enter', 'PageUp', 'PageDown',
])

/**
 * @param {Object} props
 * @param {Array} props.items - Items to display and filter
 * @param {(item: any, query: string) => boolean} props.filterFn - Filter predicate (query is pre-lowercased)
 * @param {(item: any, index: number) => React.ReactNode} props.renderItem - Render each item
 * @param {string} [props.placeholder='Search…'] - Input placeholder
 * @param {string} [props.emptyMessage='No results'] - Shown when filter yields no results
 * @param {string} [props.loadingMessage='Loading…'] - Shown while loading
 * @param {boolean} [props.loading=false] - Whether items are still loading
 * @param {React.ReactNode} [props.header] - Slot rendered between input and results (always visible)
 * @param {boolean} [props.autoFocus=true] - Focus the input on mount
 * @param {string} [props.className] - Wrapper className
 * @param {string} [props.listClassName] - Scrollable results area className
 * @param {React.RefObject} [props.inputRef] - External ref for the input element
 */
const SearchableList = forwardRef(function SearchableList(
  {
    items = [],
    filterFn,
    renderItem,
    placeholder = 'Search…',
    emptyMessage = 'No results',
    loadingMessage = 'Loading…',
    loading = false,
    header,
    autoFocus = true,
    className,
    listClassName,
    inputRef: externalInputRef,
  },
  ref,
) {
  const [query, setQuery] = useState('')
  const internalInputRef = useRef(null)
  const inputRef = externalInputRef || internalInputRef
  const listRef = useRef(null)

  // Auto-focus the input on mount — double rAF lets the host menu
  // finish its own focus management before we steal focus.
  useEffect(() => {
    if (!autoFocus) return
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    })
    return () => cancelAnimationFrame(outer)
  }, [autoFocus])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !filterFn) return items
    return items.filter((item) => filterFn(item, q))
  }, [items, query, filterFn])

  // Handle keyboard navigation between input and list.
  // Printable keys are suppressed so Radix typeahead doesn't intercept them.
  const handleKeyDown = useCallback((e) => {
    // ArrowDown from input → focus first menu item in results
    if (e.key === 'ArrowDown') {
      const firstItem = listRef.current?.querySelector('[role="menuitem"]')
      if (firstItem) {
        e.preventDefault()
        e.stopPropagation()
        firstItem.focus()
      }
      return
    }
    // Tab from input → focus first menu item (keeps user in the dropdown)
    if (e.key === 'Tab' && !e.shiftKey) {
      const firstItem = listRef.current?.querySelector('[role="menuitem"]')
      if (firstItem) {
        e.preventDefault()
        e.stopPropagation()
        firstItem.focus()
      }
      return
    }
    if (!PASSTHROUGH_KEYS.has(e.key)) {
      e.stopPropagation()
    }
  }, [])

  // Shift+Tab from any list item → return focus to the input
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleListKeyDown = useCallback((e) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      inputRef.current?.focus()
    }
  }, [])

  return (
    <div ref={ref} className={cn('flex flex-col', className)}>
      {/* Search input — pinned at top */}
      <div
        className="px-2 pt-1 pb-1.5"
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="h-9 text-xs rounded"
          aria-label={placeholder}
        />
      </div>

      {/* Optional header slot (e.g. "Create new…" button) — always visible */}
      {header}

      {/* Scrollable results area */}
      <div ref={listRef} className={cn('overflow-y-auto', listClassName)} onKeyDown={handleListKeyDown}>
        {loading ? (
          <p className="px-2 py-3 text-xs text-muted-foreground text-center">{loadingMessage}</p>
        ) : filteredItems.length > 0 ? (
          filteredItems.map(renderItem)
        ) : query.trim() ? (
          <p className="px-2 py-3 text-xs text-muted-foreground text-center">{emptyMessage}</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground text-center">No items</p>
        ) : null}
      </div>
    </div>
  )
})

export { SearchableList }
export default SearchableList
