// Package notes resolves Obsidian-style [[wikilinks]] between Markdown files.
package notes

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"nanoditor/internal/apperr"
	"nanoditor/internal/fsapi"
)

type Service struct {
	FS *fsapi.Service
}

var errStop = errors.New("stop")

// walkFiles visits the files under root, skipping hidden and dependency folders.
func walkFiles(ctx context.Context, root string, fn func(path string, d fs.DirEntry) error) error {
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
		return fn(p, d)
	})
	if errors.Is(err, errStop) {
		return nil
	}
	return err
}

// LinkRoot picks the folder a link in file `from` is resolved in, like
// Obsidian: the vault holding the file (the nearest folder with .obsidian),
// else the workspace when the file is inside it, else the file's own folder.
func (s *Service) LinkRoot(from, workspace string) string {
	dir := filepath.Dir(from)
	for d := dir; s.FS.Box.Contains(d); d = filepath.Dir(d) {
		if st, err := os.Stat(filepath.Join(d, ".obsidian")); err == nil && st.IsDir() {
			return d
		}
		if d == filepath.Dir(d) {
			break
		}
	}
	if workspace != "" && (from == workspace || strings.HasPrefix(from, workspace+string(filepath.Separator))) {
		return workspace
	}
	return dir
}

// Resolve finds the file a [[wikilink]] points to inside root, like Obsidian:
// "Idea" is a note (Idea.md), "Board.base" or "img.png" is that exact file.
// Links may include a folder ("Projects/Idea"), which is tried first; otherwise
// the shortest matching path wins.
func (s *Service) Resolve(ctx context.Context, root, name string) (string, error) {
	root, err := s.FS.Box.Resolve(root)
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
	direct := filepath.Join(root, filepath.FromSlash(name))
	for _, p := range []string{direct, direct + ".md"} {
		if real, err := s.FS.Box.Resolve(p); err == nil {
			if st, err := os.Stat(real); err == nil && !st.IsDir() {
				return real, nil
			}
		}
	}
	want := strings.ToLower(filepath.Base(name))
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	best := ""
	_ = walkFiles(ctx, root, func(p string, d fs.DirEntry) error {
		file := strings.ToLower(d.Name())
		if (file == want || file == want+".md") && (best == "" || len(p) < len(best)) {
			best = p
		}
		return nil
	})
	if best == "" {
		return "", apperr.NotFound("no note named " + name)
	}
	return best, nil
}
