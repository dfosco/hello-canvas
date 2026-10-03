import styles from './CanvasPage.module.css'

/**
 * Renders the translucent selection rectangle during a marquee drag.
 * Positioned relative to the scroll container.
 */
export default function MarqueeOverlay({ rect }) {
  if (!rect) return null
  return (
    <div
      className={styles.marqueeRect}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
      }}
    />
  )
}
