import { useRef, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import WidgetWrapper from './WidgetWrapper.jsx'
import ResizeHandle from './ResizeHandle.jsx'
import ExpandedPane from './ExpandedPane.jsx'
import CropOverlay, { CropBar } from './CropOverlay.jsx'
import { readProp } from './widgetProps.js'
import { schemas } from './widgetConfig.js'
import { toggleImagePrivacy, cropAndUpload } from '../canvasApi.js'
import { findAllConnectedSplitTargets, getSplitPaneLabel, buildPaneForWidget, buildSplitLayout } from './expandUtils.js'
import { useExpandOverride } from './useExpandOverride.js'
import { resolveBasePathAsset } from '../../basePathAsset.js'
import styles from './ImageWidget.module.css'

const imageSchema = schemas['image']

export function getImageUrl(src) {
  if (!src) return ''
  const path = globalThis.__HYPERCANVAS_NOTEBOOK_PUBLICATION__ === true
    ? `assets/canvas/images/${src}`
    : `_storyboard/canvas/images/${src}`
  return resolveBasePathAsset(path, import.meta.env?.BASE_URL || '/')
}

/**
 * Canvas widget that displays a pasted image.
 * Supports aspect-ratio locked resize, privacy toggle, and expand/split-screen.
 */
const ImageWidget = forwardRef(function ImageWidget({ id, props, onUpdate, resizable }, ref) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const [naturalRatio, setNaturalRatio] = useState(null)
  const [naturalSize, setNaturalSize] = useState(null)
  const [expandMode, setExpandMode] = useExpandOverride('image', id)
  const expanded = expandMode !== null
  const [cropping, setCropping] = useState(false)
  const [cropRect, setCropRect] = useState(null)
  const [previousSrc, setPreviousSrc] = useState(null)
  const [containerSize, setContainerSize] = useState(null)

  const src = readProp(props, 'src', imageSchema)
  const isPrivate = readProp(props, 'private', imageSchema)

  // Private images are not included in production builds
  const isHiddenInProd = isPrivate && import.meta.env?.PROD
  const width = readProp(props, 'width', imageSchema)
  const height = readProp(props, 'height', imageSchema)

  const handleImageLoad = useCallback((e) => {
    const img = e.target
    if (img.naturalWidth && img.naturalHeight) {
      setNaturalRatio(img.naturalWidth / img.naturalHeight)
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
  }, [])

  const handleResize = useCallback((newWidth) => {
    const ratio = naturalRatio || (width && height ? width / height : 4 / 3)
    const newHeight = Math.round(newWidth / ratio)
    onUpdate?.({ width: newWidth, height: newHeight })
  }, [naturalRatio, width, height, onUpdate])

  const cw = containerSize?.width || width || 400
  const ch = containerSize?.height || height || 300

  const handleCropSave = useCallback(async () => {
    if (!src || !cropRect) return
    const scaleX = (naturalSize?.width || cw) / cw
    const scaleY = (naturalSize?.height || ch) / ch
    const naturalCropRect = {
      x: Math.round(cropRect.x * scaleX),
      y: Math.round(cropRect.y * scaleY),
      width: Math.round(cropRect.width * scaleX),
      height: Math.round(cropRect.height * scaleY),
    }
    const canvasId = window.__storyboardCanvasBridgeState?.canvasId || ''
    try {
      const result = await cropAndUpload(src, naturalCropRect, canvasId)
      if (result.success) {
        setPreviousSrc(src)
        onUpdate?.({ src: result.filename })
      }
    } catch (err) {
      console.error('[canvas] Failed to crop image:', err)
    }
    setCropping(false)
    setCropRect(null)
  }, [src, cropRect, naturalSize, cw, ch, onUpdate])

  const handleCropCancel = useCallback(() => {
    setCropping(false)
    setCropRect(null)
  }, [])

  const handleCropUndo = useCallback(() => {
    if (previousSrc) {
      onUpdate?.({ src: previousSrc })
      setPreviousSrc(null)
    }
    setCropping(false)
    setCropRect(null)
  }, [previousSrc, onUpdate])

  useImperativeHandle(ref, () => ({
    handleAction(actionId) {
      if (actionId === 'expand' || actionId === 'expand-single') { setExpandMode('single'); return true }
      if (actionId === 'split-screen') { setExpandMode('split'); return true }
      if (actionId === 'crop-image') {
        // Measure container at activation time (not during render)
        const el = containerRef.current
        const w = el?.offsetWidth || width || 400
        const h = el?.offsetHeight || height || 300
        if (el) setContainerSize({ width: w, height: h })
        setCropRect({
          x: Math.round(w * 0.05),
          y: Math.round(h * 0.05),
          width: Math.round(w * 0.9),
          height: Math.round(h * 0.9),
        })
        setCropping(true)
        return true
      }
      if (actionId === 'toggle-private') {
        if (!src) return
        toggleImagePrivacy(src).then((result) => {
          if (result.success) {
            onUpdate?.({ src: result.filename, private: result.private })
          }
        }).catch((err) => {
          console.error('[canvas] Failed to toggle image privacy:', err)
        })
      } else if (actionId === 'download-image') {
        if (!src) return
        const url = getImageUrl(src)
        fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            return r.blob()
          })
          .then((blob) => {
            const blobUrl = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = blobUrl
            // Strip optional drafts/ directory prefix and leading ~ from the
            // downloaded filename — the user wants the bare basename.
            const baseName = src.includes('/') ? src.slice(src.lastIndexOf('/') + 1) : src
            a.download = baseName.replace(/^~/, '')
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(blobUrl)
          })
          .catch((err) => console.error('[canvas] Failed to download image:', err))
      } else if (actionId === 'copy-as-png') {
        if (!src) return
        const url = getImageUrl(src)
        fetch(url)
          .then((r) => r.blob())
          .then((blob) => {
            const pngBlob = blob.type === 'image/png' ? blob : blob
            navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]).catch(() => {})
          })
          .catch((err) => console.error('[canvas] Failed to copy image:', err))
      } else if (actionId === 'copy-file-path') {
        if (!src) return
        // `src` may include an optional `drafts/` prefix; in both cases the
        // file lives under assets/canvas/images/.
        navigator.clipboard.writeText(`assets/canvas/images/${src}`).catch(() => {})
      }
    }
  }), [src, onUpdate])

  if (!src || isHiddenInProd) return null

  const sizeStyle = {}
  if (typeof width === 'number') sizeStyle.width = `${width}px`

  // Compute crop dimensions in natural pixels for the CropBar display
  const scaleX = cropRect ? ((naturalSize?.width || cw) / cw) : 1
  const scaleY = cropRect ? ((naturalSize?.height || ch) / ch) : 1
  const cropW = cropRect ? Math.round(cropRect.width * scaleX) : 0
  const cropH = cropRect ? Math.round(cropRect.height * scaleY) : 0

  return (
    <>
    <WidgetWrapper className={styles.imageWrapper}>
      <div ref={containerRef} className={styles.container} style={sizeStyle} data-crop-active={cropping || undefined}>
        <div className={styles.frame}>
          <img
            ref={imgRef}
            src={getImageUrl(src)}
            alt=""
            className={styles.image}
            onLoad={handleImageLoad}
            draggable={false}
          />
          {isPrivate && !cropping && (
            <span className={styles.privateBadge} title="Private — not committed to git">
              Private
            </span>
          )}
          {cropping && cropRect && (
            <CropOverlay
              containerWidth={cw}
              containerHeight={ch}
              cropRect={cropRect}
              onCropRectChange={setCropRect}
              onCancel={handleCropCancel}
            />
          )}
        </div>
        {resizable && !cropping && (
          <ResizeHandle
            targetRef={containerRef}
            minWidth={100}
            minHeight={60}
            onResize={(w) => handleResize(w)}
          />
        )}
      </div>
    </WidgetWrapper>
    {cropping && cropRect && (
      <div className={styles.cropBarSlot}>
        <CropBar
          cropW={cropW}
          cropH={cropH}
          onSave={handleCropSave}
          onCancel={handleCropCancel}
          onUndo={handleCropUndo}
          canUndo={!!previousSrc}
        />
      </div>
    )}
    {expanded && (
      <ImageExpandPane
        widgetId={id}
        src={src}
        splitMode={expandMode === 'split'}
        onClose={() => setExpandMode(null)}
      />
    )}
    </>
  )
})

/**
 * Builds pane configs and renders ExpandedPane for an expanded image widget.
 */
function ImageExpandPane({ widgetId, src, splitMode, onClose }) {
  const connectedWidgets = useMemo(
    () => splitMode ? findAllConnectedSplitTargets(widgetId) : [],
    [widgetId, splitMode],
  )
  const primaryWidget = useMemo(() => {
    const bridge = window.__storyboardCanvasBridgeState
    return bridge?.widgets?.find((w) => w.id === widgetId) || { id: widgetId, type: 'image', position: { x: 0, y: 0 }, props: {} }
  }, [widgetId])

  const surface = splitMode ? 'splitbar' : 'fullbar'

  const buildPaneFn = useCallback((widget) => {
    if (widget.id === widgetId) {
      return {
        id: widgetId,
        label: getSplitPaneLabel(primaryWidget) || 'Image',
        widgetType: 'image',
        kind: 'react',
        render: () => (
          <div className={styles.expandedImageContainer}>
            <img
              src={getImageUrl(src)}
              alt=""
              className={styles.expandedImage}
              draggable={false}
            />
          </div>
        ),
      }
    }
    return buildPaneForWidget(widget, surface)
  }, [widgetId, primaryWidget, src, surface])

  const layout = useMemo(
    () => buildSplitLayout(primaryWidget, connectedWidgets, buildPaneFn),
    [primaryWidget, connectedWidgets, buildPaneFn],
  )

  return (
    <ExpandedPane
      initialLayout={layout}
      variant={layout.flat().length <= 1 ? 'modal' : 'full'}
      onClose={onClose}
    />
  )
}

export default ImageWidget
