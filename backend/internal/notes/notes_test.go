package notes

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"nanoditor/internal/fsapi"
	"nanoditor/internal/pathsafe"
)

func TestResolve(t *testing.T) {
	root := t.TempDir()
	for _, f := range []string{
		"proj/vault/.obsidian/app.json",
		"proj/vault/Ideas.md",
		"proj/vault/deep/Plan.md",
		"proj/vault/Board.base",
		"proj/vault/v1.2 notes.md",
		"proj/other/Plan.md",
		"proj/node_modules/x/Hidden.md",
		"proj/README.md",
	} {
		p := filepath.Join(root, f)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("# x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	box, err := pathsafe.New([]string{root}, root)
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{FS: &fsapi.Service{Box: box}}
	real := func(p string) string { r, _ := filepath.EvalSymlinks(filepath.Join(root, p)); return r }
	ws := real("proj")

	// A note in an Obsidian vault resolves inside that vault only.
	if got := s.LinkRoot(real("proj/vault/Ideas.md"), ws); got != real("proj/vault") {
		t.Errorf("LinkRoot in vault = %s", got)
	}
	// Elsewhere in the workspace, the workspace is the root.
	if got := s.LinkRoot(real("proj/README.md"), ws); got != ws {
		t.Errorf("LinkRoot in workspace = %s", got)
	}

	for _, c := range []struct{ root, name, want string }{
		{"proj/vault", "Plan", "proj/vault/deep/Plan.md"},
		{"proj/vault", "deep/Plan|alias", "proj/vault/deep/Plan.md"},
		{"proj", "ideas#Heading", "proj/vault/Ideas.md"},
		{"proj/vault", "Board.base#View", "proj/vault/Board.base"},
		{"proj/vault", "v1.2 notes", "proj/vault/v1.2 notes.md"},
		{"proj", "Hidden", ""}, // node_modules is skipped
	} {
		got, err := s.Resolve(context.Background(), real(c.root), c.name)
		want := ""
		if c.want != "" {
			want = real(c.want)
		}
		if got != want || (want != "" && err != nil) {
			t.Errorf("Resolve(%s, %q) = %q, %v; want %q", c.root, c.name, got, err, want)
		}
	}
}
