import CategoryIcon from './CategoryIcons'

const BASE_CATEGORIES = [
  'Characters', 'Environments', 'Props', 'Materials', 'HDRIs', 'VFX', 'Rigs', 'Scenes'
]

export default function Sidebar({
  categories, tags, selectedCategory, selectedTags, showStarred,
  categoryIcons,
  onSelectCategory, onToggleTag, onToggleStarred, onClearTags,
}) {
  const allCats = [...new Set([...BASE_CATEGORIES, ...categories])].sort()

  return (
    <aside className="sidebar">
      <section className="sidebar__section">
        <div className="sidebar__section-title">Browse</div>
        <ul className="sidebar__list">
          <li
            className={`sidebar__item ${!selectedCategory && !showStarred ? 'sidebar__item--active' : ''}`}
            onClick={() => { onSelectCategory(''); if (showStarred) onToggleStarred() }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            All Assets
          </li>
          <li
            className={`sidebar__item ${showStarred ? 'sidebar__item--active sidebar__item--starred' : ''}`}
            onClick={() => { onToggleStarred(); onSelectCategory('') }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24"
              fill={showStarred ? '#f5c542' : 'none'}
              stroke={showStarred ? '#f5c542' : 'currentColor'}
              strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            Starred
          </li>
        </ul>
      </section>

      <section className="sidebar__section">
        <div className="sidebar__section-title">Categories</div>
        <ul className="sidebar__list">
          {allCats.map(cat => {
            const isActive = selectedCategory === cat || selectedCategory.startsWith(cat + '/')
            return (
              <li
                key={cat}
                className={`sidebar__item ${isActive ? 'sidebar__item--active' : ''}`}
                onClick={() => onSelectCategory(isActive ? '' : cat)}
              >
                <CategoryIcon name={cat} iconKey={categoryIcons?.[cat]} />
                {cat}
              </li>
            )
          })}
        </ul>
      </section>

      {tags.length > 0 && (
        <section className="sidebar__section">
          <div className="sidebar__section-title sidebar__section-title--with-action">
            <span>Tags</span>
            {selectedTags.length > 0 && (
              <button className="sidebar__clear-btn" onClick={onClearTags} title="Clear all selected tags">
                Clear ({selectedTags.length})
              </button>
            )}
          </div>
          <ul className="sidebar__list sidebar__list--tags">
            {tags.slice(0, 40).map(({ name, count }) => (
              <li key={name} className="sidebar__tag" onClick={() => onToggleTag(name)}>
                <span className={`tag-check ${selectedTags.includes(name) ? 'tag-check--on' : ''}`}>
                  {selectedTags.includes(name) && (
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="1.5 5 4 7.5 8.5 2.5"/>
                    </svg>
                  )}
                </span>
                <span className="tag-name">#{name}</span>
                <span className="tag-count">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
