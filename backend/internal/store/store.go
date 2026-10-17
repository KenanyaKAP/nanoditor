// Package store persists app state (settings, workspaces, recents) in SQLite.
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

// Settings are app-wide. Everything about a project lives on its Workspace.
type Settings struct {
	Theme string `json:"theme"` // system | light | dark
}

// WorkspaceSettings are saved per workspace, independently of each other.
type WorkspaceSettings struct {
	ScanDepth  int  `json:"scanDepth"` // how deep to look for git repos
	ShowHidden bool `json:"showHidden"`
}

func DefaultWorkspaceSettings() WorkspaceSettings {
	return WorkspaceSettings{ScanDepth: 3}
}

type Workspace struct {
	ID           int64             `json:"id"`
	Name         string            `json:"name"`
	Path         string            `json:"path"`
	Settings     WorkspaceSettings `json:"settings"`
	CreatedAt    int64             `json:"createdAt"`
	LastOpenedAt int64             `json:"lastOpenedAt"`
}

type Recent struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	OpenedAt int64  `json:"openedAt"`
}

var migrations = []string{
	`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS workspaces (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		path TEXT NOT NULL UNIQUE,
		created_at INTEGER NOT NULL,
		last_opened_at INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS recents (
		path TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		opened_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS commit_msgs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		repo TEXT NOT NULL,
		message TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`,
}

func Open(dataDir string) (*Store, error) {
	dsn := "file:" + filepath.Join(dataDir, "nanoditor.db") + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for i, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return nil, fmt.Errorf("migration %d: %w", i, err)
		}
	}
	if err := addColumn(db, "workspaces", "settings", "TEXT NOT NULL DEFAULT '{}'"); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

// addColumn adds a column if it isn't there yet (SQLite has no IF NOT EXISTS for columns).
func addColumn(db *sql.DB, table, col, def string) error {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		if name == col {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, col, def))
	return err
}

func (s *Store) Close() error { return s.db.Close() }

func DefaultSettings() Settings {
	return Settings{Theme: "system"}
}

func (s *Store) Settings() (Settings, error) {
	set := DefaultSettings()
	var raw string
	err := s.db.QueryRow(`SELECT value FROM kv WHERE key = 'settings'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return set, nil
	}
	if err != nil {
		return set, err
	}
	if err := json.Unmarshal([]byte(raw), &set); err != nil {
		return set, err
	}
	return set, nil
}

func (s *Store) SaveSettings(set Settings) error {
	b, err := json.Marshal(set)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO kv(key, value) VALUES('settings', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, string(b))
	return err
}

func (s *Store) Workspaces() ([]Workspace, error) {
	rows, err := s.db.Query(`SELECT ` + wsCols + ` FROM workspaces ORDER BY last_opened_at DESC, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		w, err := scanWorkspace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// UpsertWorkspace creates a workspace for path, or returns the existing one.
func (s *Store) UpsertWorkspace(name, path string) (Workspace, error) {
	now := time.Now().Unix()
	_, err := s.db.Exec(`INSERT INTO workspaces(name, path, created_at, last_opened_at) VALUES(?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at`, name, path, now, now)
	if err != nil {
		return Workspace{}, err
	}
	return scanWorkspace(s.db.QueryRow(`SELECT `+wsCols+` FROM workspaces WHERE path = ?`, path))
}

func (s *Store) Workspace(id int64) (Workspace, error) {
	return scanWorkspace(s.db.QueryRow(`SELECT `+wsCols+` FROM workspaces WHERE id = ?`, id))
}

const wsCols = `id, name, path, settings, created_at, last_opened_at`

func scanWorkspace(row interface{ Scan(...any) error }) (Workspace, error) {
	var w Workspace
	var raw string
	if err := row.Scan(&w.ID, &w.Name, &w.Path, &raw, &w.CreatedAt, &w.LastOpenedAt); err != nil {
		return w, err
	}
	// Missing keys keep their defaults.
	w.Settings = DefaultWorkspaceSettings()
	_ = json.Unmarshal([]byte(raw), &w.Settings)
	return w, nil
}

func (s *Store) UpdateWorkspace(id int64, name *string, set *WorkspaceSettings, touch bool) error {
	if set != nil {
		b, err := json.Marshal(set)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(`UPDATE workspaces SET settings = ? WHERE id = ?`, string(b), id); err != nil {
			return err
		}
	}
	if name != nil {
		if _, err := s.db.Exec(`UPDATE workspaces SET name = ? WHERE id = ?`, *name, id); err != nil {
			return err
		}
	}
	if touch {
		if _, err := s.db.Exec(`UPDATE workspaces SET last_opened_at = ? WHERE id = ?`, time.Now().Unix(), id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteWorkspace(id int64) error {
	_, err := s.db.Exec(`DELETE FROM workspaces WHERE id = ?`, id)
	return err
}

func (s *Store) TouchRecent(path, kind string) error {
	_, err := s.db.Exec(`INSERT INTO recents(path, kind, opened_at) VALUES(?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at, kind = excluded.kind`,
		path, kind, time.Now().Unix())
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM recents WHERE path NOT IN
		(SELECT path FROM recents ORDER BY opened_at DESC LIMIT 100)`)
	return err
}

func (s *Store) Recents(kind string, limit int) ([]Recent, error) {
	rows, err := s.db.Query(`SELECT path, kind, opened_at FROM recents
		WHERE (? = '' OR kind = ?) ORDER BY opened_at DESC LIMIT ?`, kind, kind, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Recent{}
	for rows.Next() {
		var r Recent
		if err := rows.Scan(&r.Path, &r.Kind, &r.OpenedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) RemoveRecent(path string) error {
	_, err := s.db.Exec(`DELETE FROM recents WHERE path = ?`, path)
	return err
}

func (s *Store) AddCommitMessage(repo, msg string) error {
	_, err := s.db.Exec(`INSERT INTO commit_msgs(repo, message, created_at) VALUES(?, ?, ?)`,
		repo, msg, time.Now().Unix())
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM commit_msgs WHERE id NOT IN
		(SELECT id FROM commit_msgs ORDER BY id DESC LIMIT 200)`)
	return err
}

// CommitMessages returns recent distinct messages, this repo's first.
func (s *Store) CommitMessages(repo string, limit int) ([]string, error) {
	rows, err := s.db.Query(`SELECT message FROM commit_msgs
		GROUP BY message ORDER BY MAX(repo = ?) DESC, MAX(id) DESC LIMIT ?`, repo, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
