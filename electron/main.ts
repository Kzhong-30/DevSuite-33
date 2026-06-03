import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  return result.filePaths[0] || null
})

ipcMain.handle('read-file', async (_, filePath: string) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return content
  } catch (error) {
    return null
  }
})

ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
  try {
    const dir = path.dirname(filePath)
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true })
    }
    await fs.writeFile(filePath, content, 'utf-8')
    return true
  } catch (error) {
    return false
  }
})

ipcMain.handle('delete-file', async (_, filePath: string) => {
  try {
    await fs.unlink(filePath)
    return true
  } catch (error) {
    return false
  }
})

ipcMain.handle('create-directory', async (_, dirPath: string) => {
  try {
    await fs.mkdir(dirPath, { recursive: true })
    return true
  } catch (error) {
    return false
  }
})

ipcMain.handle('rename-file', async (_, oldPath: string, newPath: string) => {
  try {
    await fs.rename(oldPath, newPath)
    return true
  } catch (error) {
    return false
  }
})

ipcMain.handle('list-directory', async (_, dirPath: string) => {
  try {
    const files = await fs.readdir(dirPath, { withFileTypes: true })
    return files.map(f => ({
      name: f.name,
      isDirectory: f.isDirectory()
    }))
  } catch (error) {
    return []
  }
})

ipcMain.handle('get-stats', async (_, filePath: string) => {
  try {
    const stats = await fs.stat(filePath)
    return {
      modifiedAt: stats.mtime.getTime(),
      createdAt: stats.birthtime.getTime()
    }
  } catch (error) {
    return null
  }
})

ipcMain.handle('show-save-dialog', async (_, options: any) => {
  const result = await dialog.showSaveDialog(options)
  return result.filePath || null
})

ipcMain.handle('print-to-pdf', async (_, htmlContent: string) => {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: true
    }
  })
  
  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`)
  const saveDialogResult = await dialog.showSaveDialog({
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  
  if (!saveDialogResult.filePath) {
    printWindow.close()
    return null
  }
  
  const pdfData = await printWindow.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: {
      top: 1.5,
      bottom: 1.5,
      left: 1,
      right: 1
    }
  })
  await fs.writeFile(saveDialogResult.filePath, pdfData)
  printWindow.close()
  return saveDialogResult.filePath
})
