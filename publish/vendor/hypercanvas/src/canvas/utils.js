import React from 'react';

const QUEUE_KEY = 'tiny-canvas-queue';

function readQueue() {
  const raw = localStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([]));
    return [];
  }
}

/**
 * Recursively searches through React component children.
 * Returns the id prop value if found, null if not.
 */
export const findDragId = (children) => {
  if (!children) return null;

  let dragId = null;
  const checkProps = (element) => {
    if (element.props && element.props.id) {
      dragId = element.props.id;
      return;
    }
    if (element.props && element.props.children) {
      React.Children.forEach(element.props.children, checkProps);
    }
  };

  checkProps(children);
  return dragId;
};

/** djb2 string hash → 8-char hex */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Build a structural signature from a React element tree (types + shape only). */
function signature(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return '#text';

  const type = node.type;
  const name =
    typeof type === 'function'
      ? type.displayName || type.name || 'Anonymous'
      : typeof type === 'string'
        ? type
        : 'Fragment';

  const kids = node.props?.children;
  if (kids == null) return name;

  const childSigs = [];
  React.Children.forEach(kids, (child) => {
    const s = signature(child);
    if (s) childSigs.push(s);
  });

  return childSigs.length ? `${name}(${childSigs.join(',')})` : name;
}

/**
 * Generate a stable drag ID from a React element's structural shape.
 * Uses only component type names and nesting structure — immune to
 * prop/value/content changes. The index suffix disambiguates identical siblings.
 */
export const generateDragId = (element, index) => {
  const sig = signature(element);
  return `tc-${hash(sig)}-${index}`;
};

/**
 * Gets stored coordinates for a specific dragId from localStorage.
 * Returns coords object with x,y or default {x:0, y:0} if not found.
 */
export const getQueue = (dragId) => {
  try {
    const queue = readQueue();
    const coordsMap = queue.reduce((map, item) => {
      map[item.id] = { id: item.id, x: item.x, y: item.y };
      return map;
    }, {});
    return coordsMap[dragId] || { x: 0, y: 0 };
  } catch (error) {
    console.error('Error getting saved coordinates:', error);
    return { x: 0, y: 0 };
  }
};

/**
 * Initializes localStorage queue if it doesn't exist.
 */
export const refreshStorage = () => {
  try {
    const queue = localStorage.getItem(QUEUE_KEY);
    if (!queue) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify([]));
    }
  } catch (error) {
    console.error('LocalStorage is not available:', error);
  }
};

/**
 * Saves position data for a draggable element to localStorage.
 */
export const saveDrag = (dragId, x, y) => {
  try {
    const queue = readQueue();
    const now = new Date().toISOString().replace(/[:.]/g, '-');

    const dragData = { id: dragId, x, y, time: now };
    const existingIndex = queue.findIndex((item) => item.id === dragId);

    if (existingIndex >= 0) {
      queue[existingIndex] = dragData;
    } else {
      queue.push(dragData);
    }

    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Error saving drag position:', error);
  }
};
