import { Children } from 'react';
import Draggable from './Draggable';
import { findDragId, generateDragId } from './utils';

function readInitialPosition(child, pad = 0) {
  const x = Number(child?.props?.['data-tc-x']);
  const y = Number(child?.props?.['data-tc-y']);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x: Math.max(pad, x), y: Math.max(pad, y) };
  }
  return null;
}

/** Read an optional CSS selector that restricts drag to a handle element. */
function readHandle(child) {
  return child?.props?.['data-tc-handle'] || null;
}

/** Read an optional wrapper class name forwarded via data-tc-class. */
function readWrapperClassName(child) {
  const v = child?.props?.['data-tc-class'];
  return typeof v === 'string' && v.trim() ? v : null;
}

function Canvas({
  children,
  dotted = false,
  grid = false,
  gridSize,
  snapGrid,
  colorMode = 'auto',
  locked = false,
  boundaryPad,
  layout = 'absolute',
  className,
  onDragStart,
  onDrag,
  onDragEnd,
}) {
  const isFlow = layout === 'flow';
  // In flow mode, grid/dot background is meaningless — widgets sit in
  // document flow, not on a spatial surface.
  const showDots = !isFlow && (dotted || grid);
  const visualGridSize = gridSize;
  const pad = isFlow ? 0 : (boundaryPad ?? gridSize ?? 0);
  const dotRadius = visualGridSize && visualGridSize < 16 ? 1 : 2;
  const canvasStyle = !isFlow && visualGridSize
    ? {
        '--tc-grid-size': `${visualGridSize}px`,
        '--tc-grid-offset': `${visualGridSize / -2}px`,
        '--tc-dot-radius': `${dotRadius}px`,
      }
    : undefined;

  const mainClassName = className ? `tc-canvas ${className}` : 'tc-canvas';

  return (
    <main
      className={mainClassName}
      data-dotted={showDots || undefined}
      data-locked={locked || undefined}
      data-color-mode={colorMode !== 'auto' ? colorMode : undefined}
      data-layout={layout}
      style={canvasStyle}
    >
      {Children.map(children, (child, index) => {
        const dragId = findDragId(child) ?? generateDragId(child, index);
        const initialPosition = readInitialPosition(child, pad);
        const handle = readHandle(child);
        const wrapperClassName = readWrapperClassName(child);
        return (
          <Draggable
            key={dragId}
            gridSize={gridSize}
            snapGrid={snapGrid}
            dragId={dragId}
            initialPosition={initialPosition}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            handle={handle}
            locked={locked}
            boundaryPad={pad}
            layout={layout}
            wrapperClassName={wrapperClassName}
          >
            {child}
          </Draggable>
        );
      })}
    </main>
  );
}

export default Canvas;
