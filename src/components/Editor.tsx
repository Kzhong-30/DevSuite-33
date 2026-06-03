import { useState, useEffect, useCallback, useRef } from 'react'
import Editor from '@monaco-editor/react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import remarkSlug from 'remark-slug'
import type { Note } from '../types'
import { useStore, updateNote } from '../store'
import { saveNote, renameNoteFile } from '../utils/fileSystem'

interface EditorProps {
  note: Note
}

interface TocItem {
  level: number
  text: string
  id: string
}

export default function NoteEditor({ note }: EditorProps) {
  const { settings } = useStore()
  const [content, setContent] = useState(note.content)
  const [title, setTitle] = useState(note.title)
  const [toc, setToc] = useState<TocItem[]>([])
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const renameTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setContent(note.content)
    setTitle(note.title)
  }, [note.id])

  const handleSave = useCallback(async () => {
    const updatedNote = {
      ...note,
      content,
      title,
      modifiedAt: Date.now()
    }
    updateNote(note.id, { content, title, modifiedAt: Date.now() })
    try {
      const success = await saveNote(updatedNote)
      if (!success) {
        alert('保存笔记失败，请重试')
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存笔记失败，请重试')
    }
  }, [note, content, title])

  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      handleSave()
    }, settings.autoSaveInterval * 1000)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [content, title, settings.autoSaveInterval, handleSave])

  const handleTitleChange = useCallback(async (newTitle: string) => {
    setTitle(newTitle)
    
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current)
    }
    
    renameTimerRef.current = setTimeout(async () => {
      if (newTitle && newTitle !== note.title) {
        try {
          const newFilePath = await renameNoteFile(note.filePath, newTitle)
          if (newFilePath) {
            updateNote(note.id, { title: newTitle, filePath: newFilePath })
          } else {
            alert('重命名文件失败，请重试')
            setTitle(note.title)
          }
        } catch (error) {
          alert(error instanceof Error ? error.message : '重命名文件失败，请重试')
          setTitle(note.title)
        }
      }
    }, 1000)
  }, [note.id, note.filePath, note.title])

  useEffect(() => {
    const headings = content.match(/^#{1,6}\s+(.+)$/gm) || []
    const tocItems: TocItem[] = headings.map((h) => {
      const match = h.match(/^(#{1,6})\s+(.+)$/)
      const level = match ? match[1].length : 1
      const text = match ? match[2] : h
      const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
      return { level, text, id }
    })
    setToc(tocItems)
  }, [content])

  const editorTheme = settings.theme === 'dark' ? 'vs-dark' : 'light'
  const codeStyle = settings.theme === 'dark' ? oneDark : vs

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="editor-area">
      <div className="editor-panel">
        <div className="editor-tabs">
          <input
            type="text"
            className="editor-title-input"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="笔记标题"
          />
        </div>
        <div className="editor-container">
          <Editor
            height="100%"
            language="markdown"
            value={content}
            onChange={(value) => setContent(value || '')}
            theme={editorTheme}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              lineNumbers: 'on',
              fontSize: 14,
              fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
              tabSize: 2,
              padding: { top: 16, bottom: 16 }
            }}
          />
        </div>
      </div>
      <div className="preview-panel">
        <div className="preview-header">预览</div>
        {toc.length > 0 && (
          <div className="toc-container">
            <div className="toc-title">目录</div>
            <ul className="toc-list">
              {toc.map((item, index) => (
                <li
                  key={index}
                  className={`toc-item level-${item.level}`}
                  onClick={() => scrollToHeading(item.id)}
                >
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="preview-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkSlug as any]}
            components={{
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '')
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={codeStyle as any}
                    language={match[1]}
                    PreTag="div"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              }
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
