// Package fsapi implements file browsing, reading and editing inside the sandbox.
package fsapi

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"kennycode/internal/apperr"
	"kennycode/internal/pathsafe"
)

const MaxTextBytes = 2 << 20 // 2 MiB

type Service struct {
	Box      *pathsafe.Sandbox
	TrashDir string
}

type Entry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Type      string `json:"type"` // file | dir
	Size      int64  `json:"size"`
	Mtime     int64  `json:"mtime"`
	IsSymlink bool   `json:"isSymlink,omitempty"`
	Git       string `json:"git,omitempty"` // status letter, filled by caller
}

type Listing struct {
	Path    string  `json:"path"`
	Parent  string  `json:"parent,omitempty"`
	IsRoot  bool    `json:"isRoot"`
	Entries []Entry `json:"entries"`
}

func (s *Service) List(p string, showHidden, dirsOnly bool) (*Listing, error) {
	dir, err := s.Box.Resolve(p)
	if err != nil {
		return nil, err
	}
	des, err := os.ReadDir(dir)
	if err != nil {
		return nil, mapOSErr(err, p)
	}
	out := &Listing{Path: dir, Entries: []Entry{}, IsRoot: s.Box.IsRoot(dir)}
	if !out.IsRoot {
		out.Parent = filepath.Dir(dir)
	}
	for _, de := range des {
		name := de.Name()
		if name == ".git" || (!showHidden && strings.HasPrefix(name, ".")) {
			continue
		}
		full := filepath.Join(dir, name)
		e := Entry{Name: name, Path: full, Type: "file"}
		info, err := de.Info()
		if err != nil {
			continue
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			e.IsSymlink = true
			if t, err := os.Stat(full); err == nil {
				info = t
			}
		}
		if info.IsDir() {
			e.Type = "dir"
		} else if dirsOnly {
			continue
		}
		e.Size = info.Size()
		e.Mtime = info.ModTime().Unix()
		out.Entries = append(out.Entries, e)
	}
	sort.Slice(out.Entries, func(i, j int) bool {
		a, b := out.Entries[i], out.Entries[j]
		if a.Type != b.Type {
			return a.Type == "dir"
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return out, nil
}

type FileContent struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	Etag      string `json:"etag"`
	Size      int64  `json:"size"`
	Mtime     int64  `json:"mtime"`
	Mime      string `json:"mime"`
	IsBinary  bool   `json:"isBinary"`
	Truncated bool   `json:"truncated"`
	Writable  bool   `json:"writable"`
}

func (s *Service) Read(p string) (*FileContent, error) {
	path, err := s.Box.Resolve(p)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, mapOSErr(err, p)
	}
	if info.IsDir() {
		return nil, apperr.BadRequest("path is a directory")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, mapOSErr(err, p)
	}
	defer f.Close()

	buf, err := io.ReadAll(io.LimitReader(f, MaxTextBytes+1))
	if err != nil {
		return nil, err
	}
	fc := &FileContent{
		Path:     path,
		Name:     filepath.Base(path),
		Size:     info.Size(),
		Mtime:    info.ModTime().Unix(),
		Mime:     MimeType(path, buf),
		Writable: info.Mode().Perm()&0o200 != 0 && !pathsafe.InGitDir(path),
	}
	if len(buf) > MaxTextBytes {
		fc.Truncated = true
		buf = buf[:MaxTextBytes]
		fc.Writable = false
	}
	if isBinary(buf) {
		fc.IsBinary = true
		fc.Writable = false
	} else {
		fc.Content = string(buf)
	}
	if fc.Truncated {
		fc.Etag, _ = hashFile(path)
	} else {
		fc.Etag = Etag(buf)
	}
	return fc, nil
}

// Raw serves a file with Range support for images, PDFs and downloads.
func (s *Service) Raw(w http.ResponseWriter, r *http.Request, p string) error {
	path, err := s.Box.Resolve(p)
	if err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return mapOSErr(err, p)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if info.IsDir() {
		return apperr.BadRequest("path is a directory")
	}
	head := make([]byte, 512)
	n, _ := f.Read(head)
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	ct := MimeType(path, head[:n])
	if strings.HasPrefix(ct, "text/") && !strings.Contains(ct, "charset") {
		ct += "; charset=utf-8"
	}
	// Never let the browser treat served user files as active content.
	if strings.Contains(ct, "html") || strings.Contains(ct, "svg") || strings.Contains(ct, "javascript") {
		w.Header().Set("Content-Security-Policy", "sandbox")
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Name()}))
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

type WriteResult struct {
	Path  string `json:"path"`
	Etag  string `json:"etag"`
	Mtime int64  `json:"mtime"`
	Size  int64  `json:"size"`
}

// Write atomically replaces a file. If etag is non-empty and the file on disk
// no longer matches it, a 409 carrying the current etag is returned. force
// skips the check.
func (s *Service) Write(p, content, etag string, force bool) (*WriteResult, error) {
	path, err := s.Box.Resolve(p)
	if err != nil {
		return nil, err
	}
	if pathsafe.InGitDir(path) {
		return nil, apperr.Forbidden("writing inside .git is not allowed")
	}
	mode := fs.FileMode(0o644)
	info, err := os.Stat(path)
	switch {
	case err == nil:
		if info.IsDir() {
			return nil, apperr.BadRequest("path is a directory")
		}
		mode = info.Mode().Perm()
		if !force {
			if etag == "" {
				return nil, apperr.Conflict("exists", "a file with that name already exists")
			}
			cur, err := hashFile(path)
			if err != nil {
				return nil, err
			}
			if cur != etag {
				return nil, apperr.Conflict("conflict", "file changed on disk").With("etag", cur).With("mtime", info.ModTime().Unix())
			}
		}
	case errors.Is(err, fs.ErrNotExist):
		if _, err := os.Stat(filepath.Dir(path)); err != nil {
			return nil, mapOSErr(err, filepath.Dir(p))
		}
	default:
		return nil, mapOSErr(err, p)
	}

	if err := atomicWrite(path, []byte(content), mode); err != nil {
		return nil, mapOSErr(err, p)
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return &WriteResult{Path: path, Etag: Etag([]byte(content)), Mtime: st.ModTime().Unix(), Size: st.Size()}, nil
}

// Append adds text to the end of a file, creating it (and its parent
// directories) with the given header when missing.
func (s *Service) Append(p, header, text string) (*WriteResult, error) {
	path, err := s.Box.Resolve(p)
	if err != nil {
		return nil, err
	}
	if pathsafe.InGitDir(path) {
		return nil, apperr.Forbidden("writing inside .git is not allowed")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, mapOSErr(err, p)
	}
	existing, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, mapOSErr(err, p)
	}
	var b strings.Builder
	if len(existing) == 0 {
		b.WriteString(header)
	} else {
		b.Write(existing)
		if !strings.HasSuffix(string(existing), "\n") {
			b.WriteString("\n")
		}
	}
	b.WriteString(text)
	mode := fs.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	data := []byte(b.String())
	if err := atomicWrite(path, data, mode); err != nil {
		return nil, mapOSErr(err, p)
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return &WriteResult{Path: path, Etag: Etag(data), Mtime: st.ModTime().Unix(), Size: st.Size()}, nil
}

func (s *Service) Create(p, kind string) (string, error) {
	path, err := s.Box.ResolveNoFollow(p)
	if err != nil {
		return "", err
	}
	if pathsafe.InGitDir(path) {
		return "", apperr.Forbidden("writing inside .git is not allowed")
	}
	if pathsafe.Exists(path) {
		return "", apperr.Conflict("exists", "a file or folder with that name already exists")
	}
	switch kind {
	case "dir":
		err = os.MkdirAll(path, 0o755)
	case "file":
		if err = os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
			var f *os.File
			f, err = os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
			if err == nil {
				err = f.Close()
			}
		}
	default:
		return "", apperr.BadRequest("type must be file or dir")
	}
	if err != nil {
		return "", mapOSErr(err, p)
	}
	return path, nil
}

func (s *Service) Rename(from, to string) (string, error) {
	src, err := s.Box.ResolveNoFollow(from)
	if err != nil {
		return "", err
	}
	dst, err := s.Box.ResolveNoFollow(to)
	if err != nil {
		return "", err
	}
	if pathsafe.InGitDir(src) || pathsafe.InGitDir(dst) {
		return "", apperr.Forbidden("renaming inside .git is not allowed")
	}
	if s.Box.IsRoot(src) {
		return "", apperr.Forbidden("cannot rename a root folder")
	}
	if !pathsafe.Exists(src) {
		return "", apperr.NotFound("source does not exist")
	}
	if pathsafe.Exists(dst) {
		return "", apperr.Conflict("exists", "destination already exists")
	}
	if err := os.Rename(src, dst); err != nil {
		return "", mapOSErr(err, from)
	}
	return dst, nil
}

// Trash moves a file or folder into the app's trash directory.
func (s *Service) Trash(p string) (string, error) {
	path, err := s.Box.ResolveNoFollow(p)
	if err != nil {
		return "", err
	}
	if s.Box.IsRoot(path) {
		return "", apperr.Forbidden("cannot delete a root folder")
	}
	if pathsafe.InGitDir(path) {
		return "", apperr.Forbidden("deleting inside .git is not allowed")
	}
	if !pathsafe.Exists(path) {
		return "", apperr.NotFound("path does not exist")
	}
	return MoveToTrash(s.TrashDir, path)
}

// MoveToTrash moves path under trashDir/<timestamp>/, falling back to copy +
// remove when the two are on different filesystems.
func MoveToTrash(trashDir, path string) (string, error) {
	slot := filepath.Join(trashDir, time.Now().Format("20060102-150405.000000000"))
	if err := os.MkdirAll(slot, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(slot, filepath.Base(path))
	if err := os.Rename(path, dst); err != nil {
		var le *os.LinkError
		if errors.As(err, &le) && strings.Contains(le.Err.Error(), "cross-device") {
			if err := copyTree(path, dst); err != nil {
				return "", err
			}
			return dst, os.RemoveAll(path)
		}
		return "", err
	}
	return dst, nil
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, info.Mode().Perm())
		case info.Mode()&fs.ModeSymlink != 0:
			link, err := os.Readlink(p)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		default:
			in, err := os.Open(p)
			if err != nil {
				return err
			}
			defer in.Close()
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, in); err != nil {
				out.Close()
				return err
			}
			return out.Close()
		}
	})
}

func atomicWrite(path string, data []byte, mode fs.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".kc-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, mode); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func Etag(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:8])
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)[:8]), nil
}

func isBinary(b []byte) bool {
	sample := b
	if len(sample) > 8000 {
		sample = sample[:8000]
	}
	for _, c := range sample {
		if c == 0 {
			return true
		}
	}
	// Allow a split multi-byte rune at the cut-off point.
	if !utf8.Valid(b) {
		trimmed := b
		for i := 0; i < 3 && len(trimmed) > 0 && !utf8.Valid(trimmed); i++ {
			trimmed = trimmed[:len(trimmed)-1]
		}
		return !utf8.Valid(trimmed)
	}
	return false
}

func mapOSErr(err error, p string) error {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return apperr.NotFound("not found").WithDetail(p)
	case errors.Is(err, fs.ErrPermission):
		return apperr.Forbidden("permission denied").WithDetail(p)
	}
	return err
}
