/** Compatibility handler for the former workspace/home action. */
export const id = 'workspace'

export async function handler({ config = {} } = {}) {
  const { openNotebookSidebar } = await import('../../notebook/browserBridge.js')
  return {
    execute: () => openNotebookSidebar({ focusType: config.focusType || null }),
  }
}
