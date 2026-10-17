import {
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  FileArchive,
  FileTerminal,
  Folder,
  FolderSymlink,
  FileSpreadsheet,
  FileLock2,
} from 'lucide-react'
import { extname } from '../lib/path'

const code = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'go', 'py', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
  'php', 'rb', 'dart', 'vue', 'svelte', 'html', 'css', 'scss', 'sql', 'lua', 'ex', 'exs',
])
const image = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'avif', 'bmp', 'ico'])
const video = new Set(['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a'])
const archive = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'xz', 'bz2'])
const text = new Set(['md', 'markdown', 'txt', 'rst', 'pdf', 'doc', 'docx'])
const shell = new Set(['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat'])
const data = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf'])
const sheet = new Set(['csv', 'tsv', 'xlsx', 'xls'])

export function FileIcon({ name, type, symlink }: { name: string; type: 'file' | 'dir'; symlink?: boolean }) {
  const cls = 'h-5 w-5 shrink-0'
  if (type === 'dir') {
    return symlink ? <FolderSymlink className={cls + ' text-accent'} /> : <Folder className={cls + ' text-accent'} fill="currentColor" fillOpacity={0.15} />
  }
  const ext = extname(name)
  const lower = name.toLowerCase()
  if (lower.startsWith('.env') || ext === 'pem' || ext === 'key') return <FileLock2 className={cls + ' text-warn'} />
  if (lower === 'dockerfile' || lower === 'makefile' || shell.has(ext)) return <FileTerminal className={cls + ' text-muted'} />
  if (code.has(ext)) return <FileCode2 className={cls + ' text-muted'} />
  if (data.has(ext)) return <FileJson className={cls + ' text-muted'} />
  if (image.has(ext)) return <FileImage className={cls + ' text-muted'} />
  if (video.has(ext)) return <FileVideo className={cls + ' text-muted'} />
  if (archive.has(ext)) return <FileArchive className={cls + ' text-muted'} />
  if (sheet.has(ext)) return <FileSpreadsheet className={cls + ' text-muted'} />
  if (text.has(ext)) return <FileText className={cls + ' text-muted'} />
  return <File className={cls + ' text-muted'} />
}
