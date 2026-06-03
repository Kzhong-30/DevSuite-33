import { useState } from 'react'
import { useStore, setCurrentNoteId, setCurrentNotebookId, toggleNotebookExpanded, setSelectedTag, addNotebook, updateNotebook, removeNotebook, addNote, removeNote } from '../store'
import { createNotebook, renameNotebook, deleteNotebook, createNote, deleteNote, extractNoteSummary } from '../utils/fileSystem'

export default function Sidebar() {
  const { notebooks, notes, currentNoteId, currentNotebookId, selectedTag, searchQuery, settings } = useStore()
  const [renamingNotebook, setRenamingNotebook] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const filteredNotes = notes
    .filter((note) => {
      if (selectedTag && !note.tags.includes(selectedTag)) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query)
      }
      return true
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)

  const handleNewNotebook = async () => {
    if (!settings.storageDir) {
      alert('请先在设置中选择笔记存储目录')
      return
    }
    const name = prompt('输入笔记本名称:')
    if (!name) return
    try {
      const notebook = await createNotebook(settings.storageDir, name)
      addNotebook(notebook)
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建笔记本失败，请重试')
    }
  }

  const startRenameNotebook = (notebook: any) => {
    setRenamingNotebook(notebook.id)
    setRenameValue(notebook.name)
  }

  const finishRenameNotebook = async (notebook: any) => {
    if (!renameValue.trim() || renameValue === notebook.name) {
      setRenamingNotebook(null)
      return
    }
    try {
      const success = await renameNotebook(settings.storageDir!, notebook.name, renameValue)
      if (success) {
        updateNotebook(notebook.id, { name: renameValue })
      } else {
        alert('重命名笔记本失败，请重试')
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '重命名笔记本失败，请重试')
    }
    setRenamingNotebook(null)
  }

  const handleDeleteNotebook = async (notebook: any) => {
    if (!confirm(`确定要删除笔记本 "${notebook.name}" 吗？这将删除该笔记本下的所有笔记。`)) return
    try {
      await deleteNotebook(settings.storageDir!, notebook.name)
      removeNotebook(notebook.id)
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除笔记本失败，请重试')
    }
  }

  const handleNewNote = async (notebook: any) => {
    const title = prompt('输入笔记标题:', '新建笔记')
    if (title === null) return
    try {
      const newNote = await createNote(settings.storageDir!, notebook.name, notebook.id, title)
      addNote(newNote)
      setCurrentNoteId(newNote.id)
      setCurrentNotebookId(notebook.id)
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建笔记失败，请重试')
    }
  }

  const handleDeleteNote = async (note: any) => {
    if (!confirm('确定要删除这个笔记吗？')) return
    try {
      const success = await deleteNote(note.filePath)
      if (success) {
        removeNote(note.id)
        if (currentNoteId === note.id) {
          setCurrentNoteId(null)
        }
      } else {
        alert('删除笔记失败，请重试')
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除笔记失败，请重试')
    }
  }

  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags))).sort()

  const highlightText = (text: string, query: string) => {
    if (!query) return text
    const parts = text.split(new RegExp(`(${query})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} className="search-highlight">{part}</span>
      ) : (
        part
      )
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-section" style={{ flex: 1 }}>
        <div className="sidebar-header">
          <span>笔记本</span>
          <div className="sidebar-header-actions">
            <button className="icon-btn" onClick={handleNewNotebook} title="新建笔记本">
              +
            </button>
          </div>
        </div>
        <div className="sidebar-list">
          {notebooks.map((notebook) => (
            <div key={notebook.id} className="notebook-item">
              <div className={`notebook-header ${currentNotebookId === notebook.id ? 'selected' : ''}`}>
                <button className="icon-btn" onClick={() => toggleNotebookExpanded(notebook.id)}>
                  {notebook.expanded ? '▼' : '▶'}
                </button>
                {renamingNotebook === notebook.id ? (
                  <input
                    type="text"
                    className="rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => finishRenameNotebook(notebook)}
                    onKeyDown={(e) => e.key === 'Enter' && finishRenameNotebook(notebook)}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="notebook-name" onClick={() => setCurrentNotebookId(notebook.id)}>
                      📁 {notebook.name}
                    </span>
                    <span className="notebook-count">{notebook.noteCount}</span>
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleNewNote(notebook) }} title="新建笔记">
                      +
                    </button>
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); startRenameNotebook(notebook) }} title="重命名">
                      ✏️
                    </button>
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleDeleteNotebook(notebook) }} title="删除">
                      🗑️
                    </button>
                  </>
                )}
              </div>
              {notebook.expanded && (
                <div className="notes-list">
                  {filteredNotes
                    .filter((n) => n.notebookId === notebook.id)
                    .map((note) => (
                      <div
                        key={note.id}
                        className={`note-item ${currentNoteId === note.id ? 'selected' : ''}`}
                        onClick={() => {
                          setCurrentNoteId(note.id)
                          setCurrentNotebookId(notebook.id)
                        }}
                      >
                        <div className="note-title">{highlightText(note.title, searchQuery)}</div>
                        <div className="note-summary">{highlightText(extractNoteSummary(note.content), searchQuery)}</div>
                        <div className="note-tags">
                          {note.tags.map((tag) => (
                            <span
                              key={tag}
                              className={`tag ${selectedTag === tag ? 'active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedTag(selectedTag === tag ? null : tag)
                              }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="sidebar-section" style={{ maxHeight: '200px' }}>
        <div className="sidebar-header">
          <span>标签</span>
        </div>
        <div className="sidebar-list">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 12px' }}>
            {allTags.map((tag) => (
              <span
                key={tag}
                className={`tag ${selectedTag === tag ? 'active' : ''}`}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
