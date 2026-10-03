import { useDropArea } from '../hooks/useDropArea.js'
import css from './DropZone.module.css'

/**
 * Default drop surface built on useDropArea.
 *
 * Renders a `button` when `onClick` is provided, otherwise a `div`. Passing
 * `className` replaces the built-in styling; `activeClassName` (or the
 * `[data-drop-active]` attribute) styles the drag hover. `children` may be a
 * render prop `({ isOver }) => node`.
 *
 * The area claims a drop with `stopPropagation`, so nested DropZones resolve
 * to the innermost one and outer surfaces never react.
 */
export default function DropZone({
  as,
  accepts,
  onDrop,
  disabled,
  className,
  activeClassName,
  children,
  ...rest
}) {
  const { ref, isOver } = useDropArea({ accepts, onDrop, disabled })
  const Tag = as || (rest.onClick ? 'button' : 'div')
  const classes = [
    className ? null : css.dropzone,
    className,
    isOver ? (activeClassName || (className ? null : css.dropzoneActive)) : null,
  ].filter(Boolean).join(' ')
  return (
    <Tag
      ref={ref}
      className={classes || undefined}
      data-dropzone=""
      data-drop-active={isOver || undefined}
      {...rest}
    >
      {typeof children === 'function' ? children({ isOver }) : children}
    </Tag>
  )
}
