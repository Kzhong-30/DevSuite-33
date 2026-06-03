export interface Note {
  id: string
  title: string
  content: string
  notebookId: string
  tags: string[]
  modifiedAt: number
  createdAt: number
  filePath: string
}

export interface Notebook {
  id: string
  name: string
  expanded: boolean
  noteCount: number
}

export interface Settings {
  storageDir: string | null
  theme: 'light' | 'dark'
  autoSaveInterval: number
}

export interface AppState {
  notebooks: Notebook[]
  notes: Note[]
  currentNotebookId: string | null
  currentNoteId: string | null
  selectedTag: string | null
  searchQuery: string
  settings: Settings
  showSettings: boolean
}
