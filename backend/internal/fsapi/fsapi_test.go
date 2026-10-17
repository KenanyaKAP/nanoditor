package fsapi

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"kennycode/internal/apperr"
	"kennycode/internal/pathsafe"
)

func newSvc(t *testing.T) (*Service, string) {
	t.Helper()
	base, _ := filepath.EvalSymlinks(t.TempDir())
	root := filepath.Join(base, "root")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	box, err := pathsafe.New([]string{root}, root)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{Box: box, TrashDir: filepath.Join(base, "trash")}, root
}

func status(err error) int {
	if err == nil {
		return 0
	}
	return apperr.From(err).Status
}

func TestWriteConflictAndMode(t *testing.T) {
	s, root := newSvc(t)
	p := filepath.Join(root, "script.sh")
	if err := os.WriteFile(p, []byte("echo 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	fc, err := s.Read(p)
	if err != nil {
		t.Fatal(err)
	}

	// Someone else edits the file after we read it.
	if err := os.WriteFile(p, []byte("echo 2\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(p, "echo mine\n", fc.Etag, false); status(err) != http.StatusConflict {
		t.Fatalf("stale write: got %v, want 409", err)
	}
	// Writing to an existing file without an etag is also a conflict.
	if _, err := s.Write(p, "x", "", false); status(err) != http.StatusConflict {
		t.Fatalf("etag-less write: got %v, want 409", err)
	}

	fc, _ = s.Read(p)
	res, err := s.Write(p, "echo 3\n", fc.Etag, false)
	if err != nil {
		t.Fatalf("fresh write: %v", err)
	}
	info, _ := os.Stat(p)
	if info.Mode().Perm() != 0o755 {
		t.Errorf("mode = %v, want 0755", info.Mode().Perm())
	}
	if got, _ := os.ReadFile(p); string(got) != "echo 3\n" {
		t.Errorf("content = %q", got)
	}
	if again, _ := s.Read(p); again.Etag != res.Etag {
		t.Errorf("etag after write %q != read etag %q", res.Etag, again.Etag)
	}
	// No temp files left behind.
	entries, _ := os.ReadDir(root)
	if len(entries) != 1 {
		t.Errorf("leftover files: %v", entries)
	}
}

func TestWriteRefusesGitDir(t *testing.T) {
	s, root := newSvc(t)
	os.MkdirAll(filepath.Join(root, ".git"), 0o755)
	if _, err := s.Write(filepath.Join(root, ".git", "config"), "x", "", true); status(err) != http.StatusForbidden {
		t.Fatalf("got %v, want 403", err)
	}
}

func TestTrash(t *testing.T) {
	s, root := newSvc(t)
	p := filepath.Join(root, "dir", "a.txt")
	os.MkdirAll(filepath.Dir(p), 0o755)
	os.WriteFile(p, []byte("a"), 0o644)
	dst, err := s.Trash(filepath.Join(root, "dir"))
	if err != nil {
		t.Fatal(err)
	}
	if pathsafe.Exists(filepath.Join(root, "dir")) {
		t.Error("original still exists")
	}
	if b, err := os.ReadFile(filepath.Join(dst, "a.txt")); err != nil || string(b) != "a" {
		t.Errorf("trashed content missing: %v", err)
	}
	if _, err := s.Trash(root); status(err) != http.StatusForbidden {
		t.Errorf("trashing the root: got %v, want 403", err)
	}
}

func TestReadBinaryAndList(t *testing.T) {
	s, root := newSvc(t)
	os.WriteFile(filepath.Join(root, "bin.dat"), []byte{0, 1, 2, 3}, 0o644)
	os.WriteFile(filepath.Join(root, ".hidden"), []byte("h"), 0o644)
	os.MkdirAll(filepath.Join(root, "zdir"), 0o755)
	fc, err := s.Read(filepath.Join(root, "bin.dat"))
	if err != nil || !fc.IsBinary || fc.Content != "" {
		t.Fatalf("binary read: %+v %v", fc, err)
	}
	l, err := s.List(root, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Entries) != 2 || l.Entries[0].Name != "zdir" {
		t.Errorf("listing = %+v, want zdir first and no hidden files", l.Entries)
	}
}
