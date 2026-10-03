/**
 * DropZone component stories.
 * Default stoppable drop surface built on useDropArea.
 */
import { useState } from 'react'
import DropZone from './DropZone.jsx'

export function Default() {
  const [drops, setDrops] = useState([])
  return (
    <div style={{ maxWidth: 420, padding: '2rem' }}>
      <DropZone
        onDrop={drop => setDrops(current => [{ ...drop, at: Date.now() }, ...current].slice(0, 5))}
      >
        <strong>Drop files here</strong>
        <span>Claimed drops are listed below; outer surfaces never react</span>
      </DropZone>
      <ul>
        {drops.map(drop => (
          <li key={drop.at}>
            {drop.paths
              ? `Native paths: ${drop.paths.join(', ')}`
              : `Browser files: ${drop.files.map(file => file.name).join(', ')}`}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Clickable() {
  return (
    <div style={{ maxWidth: 420, padding: '2rem' }}>
      <DropZone onClick={() => {}}>
        {({ isOver }) => (
          <>
            <strong>{isOver ? 'Drop it' : 'Click or drop'}</strong>
            <span>Renders as a button when clickable</span>
          </>
        )}
      </DropZone>
    </div>
  )
}
