import { useStore, setSearchQuery, setShowSettings, setCurrentNoteId, removeNote } from '../store'
import { createNote, exportNoteAsHtml, exportNoteAsPdf, deleteNote } from '../utils/fileSystem'

export default function Toolbar() {
  const { searchQuery, currentNoteId, notes, notebooks, currentNotebookId, settings } = useStore()

  const handleNewNote = async () => {
    if (!settings.storageDir) {
      alert('请先在设置中选择笔记存储目录')
      return
    }

    const notebook = notebooks.find((nb) => nb.id === currentNotebookId) || notebooks[0]
    if (!notebook) {
      alert('请先创建一个笔记本')
      return
    }

    const title = prompt('输入笔记标题:', '新建笔记')
    if (title === null) return

    try {
      const newNote = await createNote(settings.storageDir, notebook.name, notebook.id, title)
      setCurrentNoteId(newNote.id)
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建笔记失败，请重试')
    }
  }

  const handleDeleteNote = async () => {
    const note = notes.find((n) => n.id === currentNoteId)
    if (!note) return
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

  const handleExportPdf = async () => {
    const note = notes.find((n) => n.id === currentNoteId)
    if (!note) return

    try {
      const result = await exportNoteAsPdf(note.content, note.title)
      if (result) {
        alert(`PDF 已成功导出到: ${result}`)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出PDF失败，请重试')
    }
  }

  const handleExportHtml = async () => {
    const note = notes.find((n) => n.id === currentNoteId)
    if (!note) return

    try {
      const result = await exportNoteAsHtml(note.content, note.title)
      if (result) {
        alert(`HTML 已成功导出到: ${result}`)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出HTML失败，请重试')
    }
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button className="toolbar-btn" onClick={handleNewNote}>
          📝 新建笔记
        </button>
        <button className="toolbar-btn" onClick={handleDeleteNote} disabled={!currentNoteId}>
          🗑️ 删除笔记
        </button>
      </div>
      <div className="toolbar-search">
        <input
          type="text"
          placeholder="搜索笔记..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="toolbar-right">
        <button className="toolbar-btn" onClick={handleExportPdf} disabled={!currentNoteId}>
          📄 导出 PDF
        </button>
        <button className="toolbar-btn" onClick={handleExportHtml} disabled={!currentNoteId}>
          🌐 导出 HTML
        </button>
        <button className="toolbar-btn" onClick={() => setShowSettings(true)}>
          ⚙️ 设置
        </button>
      </div>
    </div>
  )
}
