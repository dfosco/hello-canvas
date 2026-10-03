import { useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AgentChatWidget from '../canvas/widgets/AgentChatWidget.jsx'
import css from './NotebookAgentPage.module.css'

export default function NotebookAgentPage() {
  const { agentId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const widgetId = searchParams.get('widgetId') || 'agent-browser-session'
  const canvasId = searchParams.get('canvasId') || ''

  const updateAgentRoute = useCallback(updates => {
    const nextAgentId = updates?.agentId
    if (!nextAgentId) return
    const query = new URLSearchParams()
    query.set('widgetId', widgetId)
    if (canvasId) query.set('canvasId', canvasId)
    navigate(`/notebook/agent/${encodeURIComponent(nextAgentId)}?${query}`, { replace: true })
  }, [canvasId, navigate, widgetId])

  return (
    <section className={css.page} aria-labelledby="notebook-agent-title">
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>Notebook utility</p>
          <h1 id="notebook-agent-title">Agent session</h1>
          <p>{agentId ? `Session ${agentId}` : 'Start a new agent chat.'}</p>
        </div>
        {canvasId && <button type="button" onClick={() => navigate(`/canvas/${canvasId.split('/').map(encodeURIComponent).join('/')}`)}>Return to canvas</button>}
      </header>
      <div className={css.chat}>
        <AgentChatWidget
          id={widgetId}
          props={{ agentId, canvasId }}
          onUpdate={updateAgentRoute}
          resizable={false}
        />
      </div>
    </section>
  )
}
