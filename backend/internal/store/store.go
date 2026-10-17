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

type Settings struct {
	NotesRoot   string   `json:"notesRoot"`
	DailyFolder string   `json:"dailyFolder"`
	InboxFile   string   `json:"inboxFile"`
	GitRoots    []string `json:"gitRoots"`
	ScanDepth   int      `json:"scanDepth"`
	ShowHidden  bool     `json:"showHidden"`
	Theme       string   `json:"theme"` // system | light | dark
}

type Workspace struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Path         string `json:"path"`
	CreatedAt    int64  `json:"createdAt"`
	LastOpenedAt int64  `json:"lastOpenedAt"`
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
	dsn := "file:" + filepath.Join(dataDir, "kennycode.db") + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
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
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func DefaultSettings(home string) Settings {
	return Settings{
		NotesRoot:   filepath.Join(home, "Documents/ken-linux-vault"),
		DailyFolder: "Daily",
		InboxFile:   "Inbox.md",
		GitRoots:    []string{},
		ScanDepth:   3,
		Theme:       "system",
	}
}

func (s *Store) Settings(home string) (Settings, error) {
	set := DefaultSettings(home)
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
	if set.GitRoots == nil {
		set.GitRoots = []string{}
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
	rows, err := s.db.Query(`SELECT id, name, path, created_at, last_opened_at FROM workspaces
		ORDER BY last_opened_at DESC, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Workspace{}
	for rows.Next() {
		var w Workspace
		if err := rows.Scan(&w.ID, &w.Name, &w.Path, &w.CreatedAt, &w.LastOpenedAt); err != nil {
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
	var w Workspace
	err = s.db.QueryRow(`SELECT id, name, path, created_at, last_opened_at FROM workspaces WHERE path = ?`, path).
		Scan(&w.ID, &w.Name, &w.Path, &w.CreatedAt, &w.LastOpenedAt)
	return w, err
}

func (s *Store) UpdateWorkspace(id int64, name *string, touch bool) error {
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
