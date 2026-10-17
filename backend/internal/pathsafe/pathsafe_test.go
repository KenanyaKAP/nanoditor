package pathsafe

import (
	"os"
	"path/filepath"
	"testing"
)

func setup(t *testing.T) (*Sandbox, string, string) {
	t.Helper()
	base, _ := filepath.EvalSymlinks(t.TempDir())
	root := filepath.Join(base, "root")
	outside := filepath.Join(base, "outside")
	for _, d := range []string{root, outside, filepath.Join(root, "sub")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	box, err := New([]string{root}, root)
	if err != nil {
		t.Fatal(err)
	}
	return box, root, outside
}

func TestResolve(t *testing.T) {
	box, root, outside := setup(t)
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "sub"), filepath.Join(root, "inner")); err != nil {
		t.Fatal(err)
	}

	ok := []string{
		root,
		filepath.Join(root, "sub"),
		filepath.Join(root, "sub", "new-file.txt"),
		filepath.Join(root, "inner", "x"),
		"~/sub",
	}
	for _, p := range ok {
		if _, err := box.Resolve(p); err != nil {
			t.Errorf("Resolve(%q) = %v, want ok", p, err)
		}
	}
	bad := []string{
		outside,
		filepath.Join(root, "..", "outside"),
		filepath.Join(root, "sub", "..", "..", "outside", "f"),
		filepath.Join(root, "escape"),
		filepath.Join(root, "escape", "deeper", "new"),
		"relative/path",
		"",
		root + "-sibling",
	}
	for _, p := range bad {
		if _, err := box.Resolve(p); err == nil {
			t.Errorf("Resolve(%q) succeeded, want error", p)
		}
	}
}

func TestResolveNoFollowKeepsSymlink(t *testing.T) {
	box, root, outside := setup(t)
	link := filepath.Join(root, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	got, err := box.ResolveNoFollow(link)
	if err != nil {
		t.Fatalf("ResolveNoFollow: %v", err)
	}
	if got != link {
		t.Errorf("got %q, want the link itself %q", got, link)
	}
	if _, err := box.ResolveNoFollow(filepath.Join(link, "child")); err == nil {
		t.Error("child of an escaping symlink must be rejected")
	}
}

func TestInGitDir(t *testing.T) {
	cases := map[string]bool{
		"/a/.git/config":   true,
		"/a/.git":          true,
		"/a/.github/x.yml": false,
		"/a/b.git/c":       false,
	}
	for p, want := range cases {
		if got := InGitDir(p); got != want {
			t.Errorf("InGitDir(%q) = %v, want %v", p, got, want)
		}
	}
}
