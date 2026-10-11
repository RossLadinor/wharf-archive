import { useState } from 'react'
import { formatSpeed } from '../utils/format'

const STATUS_LABEL = { pending: 'Queued', downloading: 'Downloading', done: 'Done', error: 'Error', cancelled: 'Cancelled' }

export default function DownloadQueue({ queue, onClearDone }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!queue.length) return null

  const activeCount  = queue.filter(q => q.status === 'downloading').length
  const pendingCount = queue.filter(q => q.status === 'pending').length
  const doneCount    = queue.filter(q => q.status === 'done').length
  const errorCount   = queue.filter(q => q.status === 'error').length
  const hasDone      = doneCount + errorCount > 0

  return (
    <div className="dl-queue">
      <div className="dl-queue__header" onClick={() => setCollapsed(c => !c)}>
        <div className="dl-queue__header-left">
          {activeCount > 0 && <div className="dl-queue__spinner" />}
          <span className="dl-queue__title">
            {activeCount > 0
              ? `Downloading ${activeCount} asset${activeCount !== 1 ? 's' : ''}…`
              : pendingCount > 0
                ? `${pendingCount} in queue`
                : `Downloads complete`
            }
          </span>
        </div>
        <div className="dl-queue__header-right">
          {hasDone && !collapsed && (
            <button
              className="dl-queue__clear"
              onClick={e => { e.stopPropagation(); onClearDone() }}
              title="Clear completed"
            >
              Clear done
            </button>
          )}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      {!collapsed && (
        <div className="dl-queue__list">
          {queue.map(item => (
            <div key={item.id} className={`dl-queue__item dl-queue__item--${item.status}`}>
              <div className="dl-queue__item-name" title={item.assetName}>{item.assetName}</div>
              <div className="dl-queue__item-right">
                {item.status === 'downloading' && item.progress && (
                  <span className="dl-queue__item-progress">{item.progress}</span>
                )}
                {item.status === 'downloading' && !!item.speedBps && (
                  <span className="dl-queue__item-speed">{formatSpeed(item.speedBps)}</span>
                )}
                {item.status === 'error' && (
                  <span className="dl-queue__item-error" title={item.error}>Error</span>
                )}
                <span className={`dl-queue__badge dl-queue__badge--${item.status}`}>
                  {STATUS_LABEL[item.status]}
                </span>
                {item.status === 'downloading' && (
                  <button
                    className="dl-queue__item-cancel"
                    onClick={() => window.api.cancelSync()}
                    title="Cancel download"
                  >✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
