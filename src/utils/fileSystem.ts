import path from 'path'
import { marked } from 'marked'
import type { Note, Notebook } from '../types'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n').find((l) => l.trim())
  return firstLine?.trim().slice(0, 50) || 'Untitled'
}

function extractSummary(content: string): string {
  const lines = content
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .slice(0, 2)
    .join(' ')
    .replace(/[#*`\[\]]/g, '')
    .trim()
  return lines.slice(0, 100) + (lines.length > 100 ? '...' : '')
}

function extractTags(content: string): string[] {
  const tagRegex = /#(\w+)/g
  const tags: string[] = []
  let match
  while ((match = tagRegex.exec(content)) !== null) {
    if (!tags.includes(match[1])) {
      tags.push(match[1])
    }
  }
  return tags
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('permission')) {
      return '权限错误：无法访问文件，请检查文件权限'
    }
    if (message.includes('no such file') || message.includes('not found')) {
      return '文件不存在：找不到指定的文件或目录'
    }
    if (message.includes('space') || message.includes('disk')) {
      return '磁盘空间不足：请释放一些空间后重试'
    }
    if (message.includes('already exists')) {
      return '文件已存在：请选择另一个文件名'
    }
    return error.message
  }
  return '未知错误，请重试'
}

export async function scanDirectory(storageDir: string): Promise<{ notebooks: Notebook[]; notes: Note[] }> {
  const notebooks: Notebook[] = []
  const notes: Note[] = []

  if (!storageDir) return { notebooks, notes }

  try {
    const items = await window.electronAPI.listDirectory(storageDir)
    const dirItems = items.filter((item) => item.isDirectory)

    for (const dirItem of dirItems) {
      const notebookId = generateId()
      const notebookPath = path.join(storageDir, dirItem.name)
      const noteFiles = await window.electronAPI.listDirectory(notebookPath)
      const mdFiles = noteFiles.filter((f) => !f.isDirectory && f.name.endsWith('.md'))

      notebooks.push({
        id: notebookId,
        name: dirItem.name,
        expanded: true,
        noteCount: mdFiles.length
      })

      for (const mdFile of mdFiles) {
        const noteId = generateId()
        const filePath = path.join(notebookPath, mdFile.name)
        const content = await window.electronAPI.readFile(filePath)
        const stats = await window.electronAPI.getStats(filePath)

        if (content !== null) {
          notes.push({
            id: noteId,
            title: extractTitle(content),
            content,
            notebookId,
            tags: extractTags(content),
            modifiedAt: stats?.modifiedAt || Date.now(),
            createdAt: stats?.createdAt || Date.now(),
            filePath
          })
        }
      }
    }

    notebooks.forEach((nb) => {
      nb.noteCount = notes.filter((n) => n.notebookId === nb.id).length
    })
  } catch (error) {
    console.error('扫描目录失败:', error)
    throw new Error(getErrorMessage(error))
  }

  return { notebooks, notes }
}

export async function createNotebook(storageDir: string, name: string): Promise<Notebook> {
  try {
    const notebookId = generateId()
    const notebookPath = path.join(storageDir, name)
    await window.electronAPI.createDirectory(notebookPath)

    return {
      id: notebookId,
      name,
      expanded: true,
      noteCount: 0
    }
  } catch (error) {
    console.error('创建笔记本失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function renameNotebook(storageDir: string, oldName: string, newName: string): Promise<boolean> {
  try {
    const oldPath = path.join(storageDir, oldName)
    const newPath = path.join(storageDir, newName)
    return await window.electronAPI.renameFile(oldPath, newPath)
  } catch (error) {
    console.error('重命名笔记本失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function deleteNotebook(storageDir: string, name: string): Promise<boolean> {
  try {
    const notebookPath = path.join(storageDir, name)
    const files = await window.electronAPI.listDirectory(notebookPath)
    for (const file of files) {
      if (!file.isDirectory) {
        await window.electronAPI.deleteFile(path.join(notebookPath, file.name))
      }
    }
    return true
  } catch (error) {
    console.error('删除笔记本失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function createNote(
  storageDir: string,
  notebookName: string,
  notebookId: string,
  title?: string
): Promise<Note> {
  try {
    const noteId = generateId()
    const safeTitle = (title || 'Untitled').replace(/[<>:"/\\|?*]/g, '')
    const fileName = `${safeTitle}-${Date.now()}.md`
    const filePath = path.join(storageDir, notebookName, fileName)
    const initialContent = `# ${title || 'Untitled'}\n\nStart writing here...\n`

    await window.electronAPI.writeFile(filePath, initialContent)
    const stats = await window.electronAPI.getStats(filePath)

    return {
      id: noteId,
      title: title || 'Untitled',
      content: initialContent,
      notebookId,
      tags: [],
      modifiedAt: stats?.modifiedAt || Date.now(),
      createdAt: stats?.createdAt || Date.now(),
      filePath
    }
  } catch (error) {
    console.error('创建笔记失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function saveNote(note: Note): Promise<boolean> {
  try {
    const success = await window.electronAPI.writeFile(note.filePath, note.content)
    return success
  } catch (error) {
    console.error('保存笔记失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function deleteNote(filePath: string): Promise<boolean> {
  try {
    return await window.electronAPI.deleteFile(filePath)
  } catch (error) {
    console.error('删除笔记失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function renameNoteFile(oldFilePath: string, newTitle: string): Promise<string | null> {
  try {
    const dir = path.dirname(oldFilePath)
    const safeTitle = newTitle.replace(/[<>:"/\\|?*]/g, '')
    const newFileName = `${safeTitle}-${Date.now()}.md`
    const newFilePath = path.join(dir, newFileName)
    const success = await window.electronAPI.renameFile(oldFilePath, newFilePath)
    return success ? newFilePath : null
  } catch (error) {
    console.error('重命名笔记文件失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function exportNoteAsHtml(content: string, title: string): Promise<string | null> {
  try {
    const renderedHtml = await marked.parse(content, {
      async: false,
      gfm: true,
      breaks: true
    }) as string

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
    h1 { font-size: 2em; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; margin-bottom: 0.5em; }
    h2 { font-size: 1.5em; margin-top: 1em; margin-bottom: 0.5em; }
    h3 { font-size: 1.25em; margin-top: 1em; margin-bottom: 0.5em; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Monaco', 'Menlo', monospace; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #ddd; padding-left: 16px; margin: 1em 0; color: #666; }
    ul, ol { padding-left: 2em; margin-bottom: 1em; }
    p { margin-bottom: 1em; }
    a { color: #2196f3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  ${renderedHtml}
</body>
</html>`

    const savePath = await window.electronAPI.showSaveDialog({
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath: `${title}.html`
    })

    if (savePath) {
      await window.electronAPI.writeFile(savePath, htmlContent)
      return savePath
    }
    return null
  } catch (error) {
    console.error('导出HTML失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export async function exportNoteAsPdf(content: string, title: string): Promise<string | null> {
  try {
    const renderedHtml = await marked.parse(content, {
      async: false,
      gfm: true,
      breaks: true
    }) as string

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
    h1 { font-size: 2em; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; margin-bottom: 0.5em; }
    h2 { font-size: 1.5em; margin-top: 1em; margin-bottom: 0.5em; }
    h3 { font-size: 1.25em; margin-top: 1em; margin-bottom: 0.5em; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Monaco', 'Menlo', monospace; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #ddd; padding-left: 16px; margin: 1em 0; color: #666; }
    ul, ol { padding-left: 2em; margin-bottom: 1em; }
    p { margin-bottom: 1em; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  ${renderedHtml}
</body>
</html>`

    const result = await window.electronAPI.printToPdf(htmlContent)
    return result
  } catch (error) {
    console.error('导出PDF失败:', error)
    throw new Error(getErrorMessage(error))
  }
}

export function extractNoteSummary(content: string): string {
  return extractSummary(content)
}
