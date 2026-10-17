// Package notes adds note-taking helpers on top of the file service.
package notes

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kennycode/internal/apperr"
	"kennycode/internal/fsapi"
)

type Service struct {
	FS *fsapi.Service
}

type Config struct {
	Root        string
	DailyFolder string
	InboxFile   string
}

type Note struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Rel   string `json:"rel"`
	Mtime int64  `json:"mtime"`
	Size  int64  `json:"size"`
}

var errStop = errors.New("stop")

func walkNotes(ctx context.Context, root string, fn func(path string, d fs.DirEntry) error) error {
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if ctx.Err() != nil {
			return errStop
		}
		name := d.Name()
		if d.IsDir() {
			if p != root && (strings.HasPrefix(name, ".") || fsapi.SkipDirs[name]) {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(name), ".md") {
			return nil
		}
		return fn(p, d)
	})
	if errors.Is(err, errStop) {
		return nil
	}
	return err
}

func (s *Service) root(c Config) (string, error) {
	if strings.TrimSpace(c.Root) == "" {
		return "", apperr.BadRequest("notes folder is not set (see Settings)")
	}
	return s.FS.Box.Resolve(c.Root)
}

func (s *Service) Recent(ctx context.Context, c Config, limit int) ([]Note, error) {
	root, err := s.root(c)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	notes := []Note{}
	err = walkNotes(ctx, root, func(p string, d fs.DirEntry) error {
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		notes = append(notes, Note{Path: p, Name: strings.TrimSuffix(d.Name(), filepath.Ext(d.Name())),
			Rel: rel, Mtime: info.ModTime().Unix(), Size: info.Size()})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].Mtime > notes[j].Mtime })
	if len(notes) > limit {
		notes = notes[:limit]
	}
	return notes, nil
}

func (s *Service) DailyPath(c Config, t time.Time) (string, error) {
	root, err := s.root(c)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, c.DailyFolder, t.Format("2006-01-02")+".md"), nil
}

// Daily makes sure today's note exists and returns its path.
func (s *Service) Daily(c Config, now time.Time) (string, error) {
	p, err := s.DailyPath(c, now)
	if err != nil {
		return "", err
	}
	if _, err := s.FS.Append(p, dailyHeader(now), ""); err != nil {
		return "", err
	}
	return p, nil
}

// Capture appends a timestamped bullet to the inbox or today's daily note.
func (s *Service) Capture(c Config, target, text string, now time.Time) (*fsapi.WriteResult, error) {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
	if text == "" {
		return nil, apperr.BadRequest("nothing to capture")
	}
	var (
		path, header string
		err          error
	)
	switch target {
	case "daily":
		path, err = s.DailyPath(c, now)
		header = dailyHeader(now)
	case "inbox", "":
		var root string
		root, err = s.root(c)
		path = filepath.Join(root, c.InboxFile)
		header = "# Inbox\n\n"
	default:
		return nil, apperr.BadRequest("target must be inbox or daily")
	}
	if err != nil {
		return nil, err
	}
	lines := strings.Split(text, "\n")
	var b strings.Builder
	b.WriteString("- " + now.Format("2006-01-02 15:04") + " " + lines[0] + "\n")
	for _, l := range lines[1:] {
		b.WriteString("  " + l + "\n")
	}
	return s.FS.Append(path, header, b.String())
}

// Resolve finds the note a [[wikilink]] points to, matching by basename.
func (s *Service) Resolve(ctx context.Context, c Config, name string) (string, error) {
	root, err := s.root(c)
	if err != nil {
		return "", err
	}
	name = strings.TrimSpace(name)
	if i := strings.IndexAny(name, "#|"); i >= 0 {
		name = name[:i]
	}
	if name == "" {
		return "", apperr.BadRequest("empty link")
	}
	// Links may include a folder ("Projects/Idea"); try that first.
	direct := filepath.Join(root, filepath.FromSlash(name))
	if !strings.EqualFold(filepath.Ext(direct), ".md") {
		direct += ".md"
	}
	if real, err := s.FS.Box.Resolve(direct); err == nil {
		if _, err := s.FS.Read(real); err == nil {
			return real, nil
		}
	}
	want := strings.ToLower(filepath.Base(name))
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	best := ""
	_ = walkNotes(ctx, root, func(p string, d fs.DirEntry) error {
		base := strings.ToLower(strings.TrimSuffix(d.Name(), filepath.Ext(d.Name())))
		if base == want && (best == "" || len(p) < len(best)) {
			best = p
		}
		return nil
	})
	if best == "" {
		return "", apperr.NotFound("no note named " + name)
	}
	return best, nil
}

func dailyHeader(t time.Time) string {
	return "# " + t.Format("Monday, 2 January 2006") + "\n\n"
}
