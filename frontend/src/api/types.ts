export interface Identity {
  login: string
  displayName: string
  node: string
  os: string
}

export interface Me {
  identity: Identity | null
  version: string
  home: string
  roots: string[]
}

/** App-wide settings. Everything project-specific is in WorkspaceSettings. */
export interface Settings {
  theme: 'system' | 'light' | 'dark'
  /** Save edits two seconds after typing stops. */
  autosave: boolean
}

/** Saved per workspace, independently. */
export interface WorkspaceSettings {
  scanDepth: number
  showHidden: boolean
}

export interface Workspace {
  id: number
  name: string
  path: string
  settings: WorkspaceSettings
  createdAt: number
  lastOpenedAt: number
}

export interface Recent {
  path: string
  kind: 'file' | 'note'
  openedAt: number
}

export interface Entry {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  mtime: number
  isSymlink?: boolean
  git?: string
}

export interface Listing {
  path: string
  parent?: string
  isRoot: boolean
  entries: Entry[]
}

export interface ListResponse {
  listing: Listing
  repo?: string
  branch?: string
}

export interface FileContent {
  path: string
  name: string
  content: string
  etag: string
  size: number
  mtime: number
  mime: string
  isBinary: boolean
  truncated: boolean
  writable: boolean
}

export interface WriteResult {
  path: string
  etag: string
  mtime: number
  size: number
}

export interface SearchHit {
  path: string
  name: string
  type: 'file' | 'dir'
  line?: number
  text?: string
}

export interface SearchResult {
  hits: SearchHit[]
  truncated: boolean
}

export interface Branch {
  head: string
  oid: string
  upstream: string
  ahead: number
  behind: number
  detached: boolean
}

export interface FileStatus {
  path: string
  origPath?: string
  x: string
  y: string
  kind: 'ordinary' | 'rename' | 'unmerged' | 'untracked'
}

export interface Status {
  branch: Branch
  staged: FileStatus[]
  changes: FileStatus[]
  untracked: FileStatus[]
  conflicts: FileStatus[]
}

export interface StatusResponse {
  repo: string
  name: string
  status: Status
}

export interface RepoSummary {
  path: string
  name: string
  root: string
  branch: Branch
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  lastCommit?: { short: string; subject: string; time: number }
  error?: string
}

export interface DiffLine {
  t: '+' | '-' | ' ' | '\\'
  s: string
  o?: number
  n?: number
}

export interface Hunk {
  id: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  binary: boolean
  hunks: Hunk[]
  added: number
  removed: number
  tooLarge?: boolean
}

export interface Commit {
  hash: string
  short: string
  author: string
  email: string
  time: number
  subject: string
  body?: string
  refs?: string[]
  parents?: string[]
}

/** A branch or tag pointing at a commit in the history graph. */
export interface Ref {
  name: string
  kind: 'branch' | 'remote' | 'tag'
  current?: boolean
  /** The checked-out branch's upstream. */
  upstream?: boolean
}

/** One row of the history graph (git log in topological order). */
export interface LogCommit {
  hash: string
  short: string
  author: string
  time: number
  subject: string
  parents: string[]
  refs?: Ref[]
  /** HEAD points here. */
  head?: boolean
  unpushed?: boolean
}

export interface CommitDetail extends Commit {
  files: FileDiff[]
  truncated: boolean
}

export interface BranchInfo {
  name: string
  current: boolean
  upstream?: string
  remote: boolean
  time: number
}

export interface Stash {
  ref: string
  message: string
  time: number
}

export interface RemoteResult {
  output: string
}

export interface CommitResponse {
  commit: { hash: string; output: string }
  push?: RemoteResult
  pushError?: { code: string; message: string; detail?: string }
}
