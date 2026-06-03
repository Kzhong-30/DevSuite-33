import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, Note, Notebook } from './types'

const initialSettings = {
  storageDir: null,
  theme: 'light' as const,
  autoSaveInterval: 30
}

const initialState: AppState = {
  notebooks: [],
  notes: [],
  currentNotebookId: null,
  currentNoteId: null,
  selectedTag: null,
  searchQuery: '',
  settings: initialSettings,
  showSettings: false
}

export const useStore = create<AppState>()(
  persist(
    () => initialState,
    {
      name: 'knowledge-notes-storage',
      partialize: (state) => ({
        settings: state.settings
      })
    }
  )
)

export const setNotes = (notes: Note[]) => useStore.setState({ notes })
export const setNotebooks = (notebooks: Notebook[]) => useStore.setState({ notebooks })
export const setCurrentNoteId = (id: string | null) => useStore.setState({ currentNoteId: id })
export const setCurrentNotebookId = (id: string | null) => useStore.setState({ currentNotebookId: id })
export const setSelectedTag = (tag: string | null) => useStore.setState({ selectedTag: tag })
export const setSearchQuery = (query: string) => useStore.setState({ searchQuery: query })
export const setSettings = (settings: Partial<AppState['settings']>) =>
  useStore.setState((state) => ({ settings: { ...state.settings, ...settings } }))
export const setShowSettings = (show: boolean) => useStore.setState({ showSettings: show })

export const updateNote = (noteId: string, updates: Partial<Note>) =>
  useStore.setState((state) => ({
    notes: state.notes.map((n) => (n.id === noteId ? { ...n, ...updates } : n))
  }))

export const addNote = (note: Note) =>
  useStore.setState((state) => ({
    notes: [...state.notes, note]
  }))

export const removeNote = (noteId: string) =>
  useStore.setState((state) => ({
    notes: state.notes.filter((n) => n.id !== noteId)
  }))

export const addNotebook = (notebook: Notebook) =>
  useStore.setState((state) => ({
    notebooks: [...state.notebooks, notebook]
  }))

export const updateNotebook = (notebookId: string, updates: Partial<Notebook>) =>
  useStore.setState((state) => ({
    notebooks: state.notebooks.map((n) => (n.id === notebookId ? { ...n, ...updates } : n))
  }))

export const removeNotebook = (notebookId: string) =>
  useStore.setState((state) => ({
    notebooks: state.notebooks.filter((n) => n.id !== notebookId),
    notes: state.notes.filter((n) => n.notebookId !== notebookId)
  }))

export const toggleNotebookExpanded = (notebookId: string) =>
  useStore.setState((state) => ({
    notebooks: state.notebooks.map((n) =>
      n.id === notebookId ? { ...n, expanded: !n.expanded } : n
    )
  }))
