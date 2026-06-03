import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('create-directory', dirPath),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  listDirectory: (dirPath: string) => ipcRenderer.invoke('list-directory', dirPath),
  getStats: (filePath: string) => ipcRenderer.invoke('get-stats', filePath),
  showSaveDialog: (options: any) => ipcRenderer.invoke('show-save-dialog', options),
  printToPdf: (htmlContent: string) => ipcRenderer.invoke('print-to-pdf', htmlContent)
})

declare global {
  interface Window {
    electronAPI: {
      selectDirectory: () => Promise<string | null>
      readFile: (filePath: string) => Promise<string | null>
      writeFile: (filePath: string, content: string) => Promise<boolean>
      deleteFile: (filePath: string) => Promise<boolean>
      createDirectory: (dirPath: string) => Promise<boolean>
      renameFile: (oldPath: string, newPath: string) => Promise<boolean>
      listDirectory: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>
      getStats: (filePath: string) => Promise<{ modifiedAt: number; createdAt: number } | null>
      showSaveDialog: (options: any) => Promise<string | null>
      printToPdf: (htmlContent: string) => Promise<string | null>
    }
  }
}
