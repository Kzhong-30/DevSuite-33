import { useState } from 'react'
import { useStore, setSettings, setShowSettings, setNotebooks, setNotes } from '../store'
import { scanDirectory } from '../utils/fileSystem'

interface SettingsProps {
  onClose: () => void
}

export default function Settings({ onClose }: SettingsProps) {
  const { settings } = useStore()
  const [localSettings, setLocalSettings] = useState(settings)

  const handleSelectDirectory = async () => {
    const dir = await window.electronAPI.selectDirectory()
    if (dir) {
      setLocalSettings((prev) => ({ ...prev, storageDir: dir }))
    }
  }

  const handleSave = async () => {
    setSettings(localSettings)
    if (localSettings.storageDir && localSettings.storageDir !== settings.storageDir) {
      const { notebooks, notes } = await scanDirectory(localSettings.storageDir)
      setNotebooks(notebooks)
      setNotes(notes)
    }
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>设置</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="setting-item">
            <div className="setting-label">笔记存储目录</div>
            <div className="setting-value">
              <input
                type="text"
                value={localSettings.storageDir || ''}
                placeholder="选择存储目录..."
                readOnly
              />
              <button className="settings-btn" onClick={handleSelectDirectory}>
                选择目录
              </button>
            </div>
          </div>
          <div className="setting-item">
            <div className="setting-label">编辑器主题</div>
            <div className="setting-value">
              <select
                value={localSettings.theme}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    theme: e.target.value as 'light' | 'dark'
                  }))
                }
              >
                <option value="light">亮色</option>
                <option value="dark">暗色</option>
              </select>
            </div>
          </div>
          <div className="setting-item">
            <div className="setting-label">自动保存间隔（秒）</div>
            <div className="setting-value">
              <select
                value={localSettings.autoSaveInterval}
                onChange={(e) =>
                  setLocalSettings((prev) => ({
                    ...prev,
                    autoSaveInterval: parseInt(e.target.value)
                  }))
                }
              >
                <option value={5}>5 秒</option>
                <option value={10}>10 秒</option>
                <option value={30}>30 秒</option>
                <option value={60}>1 分钟</option>
                <option value={120}>2 分钟</option>
              </select>
            </div>
          </div>
        </div>
        <div style={{ padding: '16px 20px', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="settings-btn" onClick={onClose}>取消</button>
          <button className="settings-btn primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  )
}
