package gitx

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"nanoditor/internal/apperr"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func newRepo(t *testing.T) string {
	t.Helper()
	dir, _ := filepath.EvalSymlinks(t.TempDir())
	git(t, dir, "init", "-q", "-b", "main")
	git(t, dir, "config", "user.name", "t")
	git(t, dir, "config", "user.email", "t@t")
	git(t, dir, "config", "commit.gpgsign", "false")
	return dir
}

func write(t *testing.T, path, content string) {
	t.Helper()
	os.MkdirAll(filepath.Dir(path), 0o755)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func lines(n int, f func(i int) string) string {
	var b strings.Builder
	for i := 1; i <= n; i++ {
		b.WriteString(f(i) + "\n")
	}
	return b.String()
}

func TestParseStatus(t *testing.T) {
	repo := newRepo(t)
	svc := &Service{R: &Runner{}}
	ctx := context.Background()

	write(t, filepath.Join(repo, "a.txt"), "a\n")
	write(t, filepath.Join(repo, "old name.txt"), "rename me\n")
	git(t, repo, "add", ".")
	git(t, repo, "commit", "-q", "-m", "init")

	write(t, filepath.Join(repo, "a.txt"), "a changed\n")
	git(t, repo, "mv", "old name.txt", "new name.txt")
	write(t, filepath.Join(repo, "dir", "ünïcode.md"), "u\n")

	st, err := svc.Status(ctx, repo)
	if err != nil {
		t.Fatal(err)
	}
	if st.Branch.Head != "main" || st.Branch.Oid == "" {
		t.Errorf("branch = %+v", st.Branch)
	}
	if len(st.Changes) != 1 || st.Changes[0].Path != "a.txt" || st.Changes[0].Y != "M" {
		t.Errorf("changes = %+v", st.Changes)
	}
	if len(st.Staged) != 1 || st.Staged[0].Path != "new name.txt" || st.Staged[0].OrigPath != "old name.txt" {
		t.Errorf("staged = %+v", st.Staged)
	}
	if len(st.Untracked) != 1 || st.Untracked[0].Path != "dir/ünïcode.md" {
		t.Errorf("untracked = %+v", st.Untracked)
	}
}

func TestHunkStageUnstageRoundTrip(t *testing.T) {
	repo := newRepo(t)
	svc := &Service{R: &Runner{}}
	ctx := context.Background()
	file := filepath.Join(repo, "f.txt")

	write(t, file, lines(40, func(i int) string { return "line" }))
	git(t, repo, "add", ".")
	git(t, repo, "commit", "-q", "-m", "init")
	// Two edits far apart produce two hunks.
	write(t, file, lines(40, func(i int) string {
		switch i {
		case 3:
			return "first change"
		case 35:
			return "second change"
		}
		return "line"
	}))

	d, err := svc.Diff(ctx, repo, "f.txt", false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Hunks) != 2 {
		t.Fatalf("want 2 hunks, got %d", len(d.Hunks))
	}
	if d.Added != 2 || d.Removed != 2 {
		t.Errorf("added/removed = %d/%d", d.Added, d.Removed)
	}
	second := d.Hunks[1]
	if second.Lines[0].OldNo != second.OldStart {
		t.Errorf("line numbering off: %+v", second.Lines[0])
	}

	if err := svc.ApplyHunk(ctx, repo, "f.txt", second.ID, "stage"); err != nil {
		t.Fatalf("stage hunk: %v", err)
	}
	cached := git(t, repo, "diff", "--cached")
	if !strings.Contains(cached, "+second change") || strings.Contains(cached, "first change") {
		t.Fatalf("index should hold only the second hunk:\n%s", cached)
	}

	// Stale id is rejected.
	if err := svc.ApplyHunk(ctx, repo, "f.txt", second.ID, "stage"); apperr.From(err).Status != http.StatusConflict {
		t.Errorf("stale hunk: got %v, want 409", err)
	}

	sd, err := svc.Diff(ctx, repo, "f.txt", true, false)
	if err != nil || len(sd.Hunks) != 1 {
		t.Fatalf("staged diff: %v %+v", err, sd)
	}
	if err := svc.ApplyHunk(ctx, repo, "f.txt", sd.Hunks[0].ID, "unstage"); err != nil {
		t.Fatalf("unstage hunk: %v", err)
	}
	if out := git(t, repo, "diff", "--cached"); out != "" {
		t.Fatalf("index should be clean again:\n%s", out)
	}

	// Discard the first hunk from the worktree.
	d, _ = svc.Diff(ctx, repo, "f.txt", false, false)
	if err := svc.ApplyHunk(ctx, repo, "f.txt", d.Hunks[0].ID, "discard"); err != nil {
		t.Fatalf("discard hunk: %v", err)
	}
	b, _ := os.ReadFile(file)
	if strings.Contains(string(b), "first change") || !strings.Contains(string(b), "second change") {
		t.Fatalf("discard removed the wrong hunk:\n%s", b)
	}
}

func TestNoNewlineHunk(t *testing.T) {
	repo := newRepo(t)
	svc := &Service{R: &Runner{}}
	ctx := context.Background()
	write(t, filepath.Join(repo, "n.txt"), "a\nb")
	git(t, repo, "add", ".")
	git(t, repo, "commit", "-q", "-m", "init")
	write(t, filepath.Join(repo, "n.txt"), "a\nc")
	d, err := svc.Diff(ctx, repo, "n.txt", false, false)
	if err != nil || len(d.Hunks) != 1 {
		t.Fatalf("%v %+v", err, d)
	}
	if err := svc.ApplyHunk(ctx, repo, "n.txt", d.Hunks[0].ID, "stage"); err != nil {
		t.Fatalf("stage no-newline hunk: %v", err)
	}
}

func TestCommitLogShowAndUnstageInitial(t *testing.T) {
	repo := newRepo(t)
	svc := &Service{R: &Runner{}}
	ctx := context.Background()

	write(t, filepath.Join(repo, "x.txt"), "x\n")
	if err := svc.Stage(ctx, repo, []string{"x.txt"}); err != nil {
		t.Fatal(err)
	}
	// Unstaging before the first commit has no HEAD to restore from.
	if err := svc.Unstage(ctx, repo, []string{"x.txt"}); err != nil {
		t.Fatalf("unstage on initial repo: %v", err)
	}
	if err := svc.Stage(ctx, repo, []string{"x.txt"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Commit(ctx, repo, "", false); err == nil {
		t.Error("empty message must fail")
	}
	res, err := svc.Commit(ctx, repo, "first commit\n\nbody text", false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Hash == "" {
		t.Error("no hash")
	}
	if _, err := svc.Commit(ctx, repo, "", true); err != nil {
		t.Fatalf("amend --no-edit: %v", err)
	}
	log, err := svc.Log(ctx, repo, 10, 0)
	if err != nil || len(log) != 1 || log[0].Subject != "first commit" {
		t.Fatalf("log = %+v %v", log, err)
	}
	show, err := svc.Show(ctx, repo, log[0].Hash)
	if err != nil {
		t.Fatal(err)
	}
	if show.Body != "body text" || len(show.Files) != 1 || show.Files[0].Status != "added" {
		t.Errorf("show = %+v", show)
	}
	br, err := svc.Branches(ctx, repo)
	if err != nil || len(br) != 1 || !br[0].Current {
		t.Errorf("branches = %+v %v", br, err)
	}
}

func TestDiscover(t *testing.T) {
	root, _ := filepath.EvalSymlinks(t.TempDir())
	for _, p := range []string{"a", "group/b", "group/b/nested", "deep/1/2/3/c", "node_modules/d", ".hidden/e"} {
		dir := filepath.Join(root, p)
		os.MkdirAll(dir, 0o755)
		git(t, dir, "init", "-q")
	}
	got := Discover(root, 3)
	want := map[string]bool{filepath.Join(root, "a"): true, filepath.Join(root, "group/b"): true}
	if len(got) != len(want) {
		t.Fatalf("Discover = %v", got)
	}
	for _, g := range got {
		if !want[g] {
			t.Errorf("unexpected repo %s", g)
		}
	}
}
