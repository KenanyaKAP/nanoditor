// Package pathsafe confines filesystem access to a set of allowed roots.
package pathsafe

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"nanoditor/internal/apperr"
)

type Sandbox struct {
	roots []string // cleaned, symlink-resolved
	home  string
}

func New(roots []string, home string) (*Sandbox, error) {
	s := &Sandbox{home: home}
	for _, r := range roots {
		abs, err := filepath.Abs(expand(r, home))
		if err != nil {
			return nil, err
		}
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			abs = real
		}
		s.roots = append(s.roots, filepath.Clean(abs))
	}
	if len(s.roots) == 0 {
		return nil, errors.New("pathsafe: no allowed roots")
	}
	return s, nil
}

func (s *Sandbox) Roots() []string { return append([]string(nil), s.roots...) }

// Contains reports whether an already-resolved absolute path is inside a root.
func (s *Sandbox) Contains(abs string) bool { return s.inside(filepath.Clean(abs)) }

// Resolve returns the real absolute path for p, following symlinks, and fails
// if the result is outside the allowed roots. p need not exist; missing tail
// components are appended to the resolved existing prefix.
func (s *Sandbox) Resolve(p string) (string, error) {
	abs, err := s.clean(p)
	if err != nil {
		return "", err
	}
	real, err := resolveExisting(abs)
	if err != nil {
		return "", err
	}
	if !s.inside(real) {
		return "", outside(p)
	}
	return real, nil
}

// ResolveNoFollow resolves the parent directory but keeps the final element
// as-is, so operations like delete or rename act on a symlink itself rather
// than its target.
func (s *Sandbox) ResolveNoFollow(p string) (string, error) {
	abs, err := s.clean(p)
	if err != nil {
		return "", err
	}
	if s.isRoot(abs) {
		return abs, nil
	}
	parent, err := resolveExisting(filepath.Dir(abs))
	if err != nil {
		return "", err
	}
	full := filepath.Join(parent, filepath.Base(abs))
	if !s.inside(full) {
		return "", outside(p)
	}
	return full, nil
}

// IsRoot reports whether p is exactly one of the allowed roots.
func (s *Sandbox) IsRoot(p string) bool {
	abs, err := s.clean(p)
	return err == nil && s.isRoot(abs)
}

func (s *Sandbox) isRoot(abs string) bool {
	for _, r := range s.roots {
		if abs == r {
			return true
		}
	}
	return false
}

// InGitDir reports whether any path component is ".git".
func InGitDir(p string) bool {
	for _, part := range strings.Split(filepath.ToSlash(p), "/") {
		if part == ".git" {
			return true
		}
	}
	return false
}

func (s *Sandbox) clean(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", apperr.BadRequest("path is required")
	}
	if strings.ContainsRune(p, 0) {
		return "", apperr.BadRequest("invalid path")
	}
	p = expand(p, s.home)
	if !filepath.IsAbs(p) {
		return "", apperr.BadRequest("path must be absolute")
	}
	return filepath.Clean(p), nil
}

func (s *Sandbox) inside(p string) bool {
	for _, r := range s.roots {
		if p == r || strings.HasPrefix(p, r+string(filepath.Separator)) || r == "/" {
			return true
		}
	}
	return false
}

func resolveExisting(abs string) (string, error) {
	var tail []string
	cur := abs
	for {
		real, err := filepath.EvalSymlinks(cur)
		if err == nil {
			for i := len(tail) - 1; i >= 0; i-- {
				real = filepath.Join(real, tail[i])
			}
			return real, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return "", err
		}
		tail = append(tail, filepath.Base(cur))
		cur = parent
	}
}

func expand(p, home string) string {
	if p == "~" {
		return home
	}
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[2:])
	}
	return p
}

func outside(p string) error {
	return apperr.Forbidden("path is outside the allowed roots").WithDetail(p)
}

// Exists is a small helper used across packages.
func Exists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}
