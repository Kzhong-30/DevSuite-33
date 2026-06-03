import { useEffect, useCallback } from 'react'
import { useStore, setNotes, setNotebooks, setCurrentNoteId, setCurrentNotebookId, setShowSettings } from './store'
import { scanDirectory } from './utils/fileSystem'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import Settings from './components/Settings'

function App() {
  const { settings, showSettings, notes, notebooks, currentNoteId } = useStore()

  useEffect(() => {
    if (settings.storageDir) {
      loadNotes()
    }
  }, [settings.storageDir])

  const loadNotes = useCallback(async () => {
    if (!settings.storageDir) return
    const { notebooks: loadedNotebooks, notes: loadedNotes } = await scanDirectory(settings.storageDir)
    setNotebooks(loadedNotebooks)
    setNotes(loadedNotes)
  }, [settings.storageDir])

  const currentNote = notes.find((n) => n.id === currentNoteId)
  const currentNotebook = notebooks.find((nb) => nb.id === currentNoteId)

  return (
    <div className={`app ${settings.theme}`}>
      <Toolbar />
      <div className="main-content">
        <Sidebar />
        {currentNote ? (
          <Editor note={currentNote} />
        ) : (
          <div className="editor-area">
            <div className="empty-state">
              <h3>选择一个笔记或创建新笔记</h3>
              <p>从左侧选择一个笔记开始编辑，或创建一个新笔记</p>
            </div>
          </div>
        )}
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}

export default App
