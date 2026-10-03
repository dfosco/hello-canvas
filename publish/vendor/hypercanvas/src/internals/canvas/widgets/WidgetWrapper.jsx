import styles from './WidgetWrapper.module.css'

/**
 * Common wrapper for all canvas widgets.
 * Provides shadow/border styling.
 */
export default function WidgetWrapper({ children, className }) {
  return (
    <section className={`${styles.wrapper} ${className || ''}`}>
      <div className={styles.content}>
        {children}
      </div>
    </section>
  )
}
