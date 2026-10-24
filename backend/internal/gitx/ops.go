package gitx

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"nanoditor/internal/apperr"
)

const maxDiffBytes = 1 << 20

type Service struct {
	R *Runner
}

// Toplevel returns the repository root containing dir.
func (s *Service) Toplevel(ctx context.Context, dir string) (string, error) {
	res, err := s.R.run(ctx, dir, runOpts{}, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}

func (s *Service) Status(ctx context.Context, repo string) (*Status, error) {
	res, err := s.R.run(ctx, repo, runOpts{}, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	return ParseStatus(res.Stdout), nil
}

func (s *Service) hasHead(ctx context.Context, repo string) bool {
	_, err := s.R.run(ctx, repo, runOpts{}, "rev-parse", "--verify", "-q", "HEAD")
	return err == nil
}

// Diff returns the diff for one path. untracked files are diffed against /dev/null.
func (s *Service) Diff(ctx context.Context, repo, path string, staged, untracked bool) (*FileDiff, error) {
	var res *Result
	var err error
	switch {
	case untracked:
		res, err = s.R.run(ctx, repo, runOpts{okCodes: []int{1}}, "diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", path)
	case staged:
		res, err = s.R.run(ctx, repo, runOpts{}, "diff", "--cached", "--no-color", "--no-ext-diff", "-U3", "--", path)
	default:
		res, err = s.R.run(ctx, repo, runOpts{}, "diff", "--no-color", "--no-ext-diff", "-U3", "--", path)
	}
	if err != nil {
		return nil, err
	}
	if len(res.Stdout) > maxDiffBytes {
		return &FileDiff{Path: path, Status: "modified", Hunks: []*Hunk{}, TooLarge: true}, nil
	}
	files := ParseDiff(string(res.Stdout))
	if len(files) == 0 {
		return &FileDiff{Path: path, Status: "modified", Hunks: []*Hunk{}}, nil
	}
	f := files[0]
	if untracked {
		f.Path, f.OldPath, f.Status = path, "", "added"
	}
	return f, nil
}

// ApplyHunk stages, unstages or discards a single hunk identified by id.
func (s *Service) ApplyHunk(ctx context.Context, repo, path, hunkID, action string) error {
	staged := action == "unstage"
	f, err := s.Diff(ctx, repo, path, staged, false)
	if err != nil {
		return err
	}
	var target *Hunk
	for _, h := range f.Hunks {
		if h.ID == hunkID {
			target = h
			break
		}
	}
	if target == nil {
		return apperr.Conflict("stale_hunk", "The file changed since the diff was loaded. Refresh and try again.")
	}
	args := []string{"apply", "--whitespace=nowarn"}
	switch action {
	case "stage":
		args = append(args, "--cached")
	case "unstage":
		args = append(args, "--cached", "-R")
	case "discard":
		args = append(args, "-R")
	default:
		return apperr.BadRequest("action must be stage, unstage or discard")
	}
	args = append(args, "-")
	_, err = s.R.run(ctx, repo, runOpts{stdin: f.Patch(target), write: true}, args...)
	return err
}

func (s *Service) Stage(ctx context.Context, repo string, paths []string) error {
	if len(paths) == 0 {
		return apperr.BadRequest("no paths")
	}
	_, err := s.R.run(ctx, repo, runOpts{write: true}, append([]string{"add", "-A", "--"}, paths...)...)
	return err
}

func (s *Service) Unstage(ctx context.Context, repo string, paths []string) error {
	if len(paths) == 0 {
		return apperr.BadRequest("no paths")
	}
	if !s.hasHead(ctx, repo) {
		_, err := s.R.run(ctx, repo, runOpts{write: true}, append([]string{"rm", "--cached", "-r", "-q", "--"}, paths...)...)
		return err
	}
	_, err := s.R.run(ctx, repo, runOpts{write: true}, append([]string{"restore", "--staged", "--"}, paths...)...)
	return err
}

// Discard reverts tracked paths in the worktree to the index version.
// Untracked paths are handled by the caller (moved to trash).
func (s *Service) Discard(ctx context.Context, repo string, paths []string) error {
	if len(paths) == 0 {
		return apperr.BadRequest("no paths")
	}
	_, err := s.R.run(ctx, repo, runOpts{write: true}, append([]string{"restore", "--worktree", "--"}, paths...)...)
	return err
}

type CommitResult struct {
	Hash   string `json:"hash"`
	Output string `json:"output"`
}

func (s *Service) Commit(ctx context.Context, repo, message string, amend bool) (*CommitResult, error) {
	message = strings.TrimSpace(message)
	args := []string{"commit"}
	if amend {
		args = append(args, "--amend")
	}
	var stdin []byte
	if message == "" {
		if !amend {
			return nil, apperr.BadRequest("commit message is required")
		}
		args = append(args, "--no-edit")
	} else {
		args = append(args, "-F", "-")
		stdin = []byte(message + "\n")
	}
	res, err := s.R.run(ctx, repo, runOpts{stdin: stdin, write: true, timeout: 2 * time.Minute}, args...)
	if err != nil {
		return nil, err
	}
	head, _ := s.R.run(ctx, repo, runOpts{}, "rev-parse", "--short", "HEAD")
	out := strings.TrimSpace(string(res.Stdout) + "\n" + res.Stderr)
	return &CommitResult{Hash: strings.TrimSpace(string(head.Stdout)), Output: out}, nil
}

type RemoteResult struct {
	Output string `json:"output"`
}

func (s *Service) Fetch(ctx context.Context, repo string) (*RemoteResult, error) {
	return s.remote(ctx, repo, "fetch", "--prune")
}

func (s *Service) Pull(ctx context.Context, repo string, rebase bool) (*RemoteResult, error) {
	if rebase {
		return s.remote(ctx, repo, "pull", "--rebase")
	}
	return s.remote(ctx, repo, "pull", "--ff-only")
}

func (s *Service) Push(ctx context.Context, repo string) (*RemoteResult, error) {
	st, err := s.Status(ctx, repo)
	if err != nil {
		return nil, err
	}
	if st.Branch.Detached {
		return nil, apperr.BadRequest("cannot push a detached HEAD")
	}
	if st.Branch.Upstream != "" {
		return s.remote(ctx, repo, "push")
	}
	remote, err := s.defaultRemote(ctx, repo)
	if err != nil {
		return nil, err
	}
	return s.remote(ctx, repo, "push", "-u", remote, "HEAD")
}

func (s *Service) defaultRemote(ctx context.Context, repo string) (string, error) {
	res, err := s.R.run(ctx, repo, runOpts{}, "remote")
	if err != nil {
		return "", err
	}
	remotes := strings.Fields(string(res.Stdout))
	if len(remotes) == 0 {
		return "", apperr.BadRequest("this repo has no remote")
	}
	for _, r := range remotes {
		if r == "origin" {
			return r, nil
		}
	}
	return remotes[0], nil
}

func (s *Service) remote(ctx context.Context, repo string, args ...string) (*RemoteResult, error) {
	res, err := s.R.run(ctx, repo, runOpts{write: true, timeout: 90 * time.Second}, args...)
	if err != nil {
		return nil, err
	}
	out := strings.TrimSpace(string(res.Stdout) + "\n" + res.Stderr)
	if out == "" {
		out = "Done."
	}
	return &RemoteResult{Output: out}, nil
}

type Commit struct {
	Hash    string   `json:"hash"`
	Short   string   `json:"short"`
	Author  string   `json:"author"`
	Email   string   `json:"email"`
	Time    int64    `json:"time"`
	Subject string   `json:"subject"`
	Body    string   `json:"body,omitempty"`
	Refs    []Ref    `json:"refs,omitempty"`
	Parents []string `json:"parents,omitempty"`
}

// Ref is a branch or tag pointing at a commit in the history graph.
type Ref struct {
	Name     string `json:"name"` // main, origin/main, v1.0
	Kind     string `json:"kind"` // branch | remote | tag
	Current  bool   `json:"current,omitempty"`
	Upstream bool   `json:"upstream,omitempty"` // the current branch's upstream
}

// LogCommit is one row of the history graph.
type LogCommit struct {
	Hash     string   `json:"hash"`
	Short    string   `json:"short"`
	Author   string   `json:"author"`
	Time     int64    `json:"time"`
	Subject  string   `json:"subject"`
	Parents  []string `json:"parents"`
	Refs     []Ref    `json:"refs,omitempty"`
	Head     bool     `json:"head,omitempty"` // HEAD points here
	Unpushed bool     `json:"unpushed,omitempty"`
}

const logFormat = "%H%x1f%h%x1f%an%x1f%ct%x1f%s%x1f%D%x1f%P%x1e"

// Log lists commits newest first in topological order (children before
// parents), so the client can draw the branch graph. With all it covers every
// branch, remote and tag; otherwise the current branch and its upstream.
func (s *Service) Log(ctx context.Context, repo string, limit, skip int, all bool) ([]LogCommit, error) {
	out := []LogCommit{}
	if !s.hasHead(ctx, repo) {
		return out, nil
	}
	upstream := s.upstream(ctx, repo)
	args := []string{"log", "--format=" + logFormat, "--decorate=full", "--topo-order",
		"-n", strconv.Itoa(limit), "--skip", strconv.Itoa(skip)}
	if all {
		args = append(args, "--branches", "--remotes", "--tags", "HEAD")
	} else {
		args = append(args, "HEAD")
		if upstream != "" {
			args = append(args, "@{upstream}")
		}
	}
	res, err := s.R.run(ctx, repo, runOpts{}, append(args, "--")...)
	if err != nil {
		return nil, err
	}
	unpushed := map[string]bool{}
	if r, err := s.R.run(ctx, repo, runOpts{}, "rev-list", "@{upstream}..HEAD"); err == nil {
		for _, h := range strings.Fields(string(r.Stdout)) {
			unpushed[h] = true
		}
	}
	for _, rec := range strings.Split(string(res.Stdout), "\x1e") {
		rec = strings.TrimLeft(rec, "\n")
		f := strings.Split(rec, "\x1f")
		if len(f) < 7 {
			continue
		}
		c := LogCommit{Hash: f[0], Short: f[1], Author: f[2], Subject: f[4], Parents: strings.Fields(f[6])}
		c.Time, _ = strconv.ParseInt(f[3], 10, 64)
		c.Refs, c.Head = parseDecorations(f[5], upstream)
		c.Unpushed = unpushed[c.Hash]
		out = append(out, c)
	}
	return out, nil
}

// upstream names the current branch's upstream ("origin/main"), or "" if it has none.
func (s *Service) upstream(ctx context.Context, repo string) string {
	r, err := s.R.run(ctx, repo, runOpts{}, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(r.Stdout))
}

// parseDecorations reads a --decorate=full %D list such as
// "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1".
func parseDecorations(d, upstream string) (refs []Ref, head bool) {
	if d == "" {
		return nil, false
	}
	for _, part := range strings.Split(d, ", ") {
		current := false
		if rest, ok := strings.CutPrefix(part, "HEAD -> "); ok {
			head, current, part = true, true, rest
		} else if part == "HEAD" {
			head = true // detached
			continue
		}
		part = strings.TrimPrefix(part, "tag: ")
		if name, ok := strings.CutPrefix(part, "refs/heads/"); ok {
			refs = append(refs, Ref{Name: name, Kind: "branch", Current: current})
		} else if name, ok := strings.CutPrefix(part, "refs/remotes/"); ok {
			if !strings.HasSuffix(name, "/HEAD") {
				refs = append(refs, Ref{Name: name, Kind: "remote", Upstream: name == upstream})
			}
		} else if name, ok := strings.CutPrefix(part, "refs/tags/"); ok {
			refs = append(refs, Ref{Name: name, Kind: "tag"})
		}
	}
	return refs, head
}

type CommitDetail struct {
	Commit
	Files     []*FileDiff `json:"files"`
	Truncated bool        `json:"truncated"`
}

func (s *Service) Show(ctx context.Context, repo, rev string) (*CommitDetail, error) {
	if strings.HasPrefix(rev, "-") {
		return nil, apperr.BadRequest("invalid revision")
	}
	res, err := s.R.run(ctx, repo, runOpts{}, "show", "--no-color", "--no-ext-diff", "-U3",
		"--diff-merges=first-parent", "--decorate=full", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%b%x1f%D%x1f%P%x1e", rev, "--")
	if err != nil {
		return nil, err
	}
	out := string(res.Stdout)
	head, body, _ := strings.Cut(out, "\x1e")
	f := strings.Split(head, "\x1f")
	if len(f) < 9 {
		return nil, apperr.NotFound("commit not found")
	}
	d := &CommitDetail{Commit: Commit{Hash: f[0], Short: f[1], Author: f[2], Email: f[3],
		Subject: f[5], Body: strings.TrimSpace(f[6])}}
	d.Time, _ = strconv.ParseInt(f[4], 10, 64)
	d.Refs, _ = parseDecorations(f[7], s.upstream(ctx, repo))
	d.Parents = strings.Fields(f[8])
	if len(body) > 2*maxDiffBytes {
		body = body[:2*maxDiffBytes]
		if i := strings.LastIndex(body, "\ndiff --git "); i > 0 {
			body = body[:i]
		}
		d.Truncated = true
	}
	d.Files = ParseDiff(body)
	if d.Files == nil {
		d.Files = []*FileDiff{}
	}
	return d, nil
}

type BranchInfo struct {
	Name     string `json:"name"`
	Current  bool   `json:"current"`
	Upstream string `json:"upstream,omitempty"`
	Remote   bool   `json:"remote"`
	Time     int64  `json:"time"`
}

func (s *Service) Branches(ctx context.Context, repo string) ([]BranchInfo, error) {
	res, err := s.R.run(ctx, repo, runOpts{}, "for-each-ref", "--sort=-committerdate",
		"--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(committerdate:unix)",
		"refs/heads", "refs/remotes")
	if err != nil {
		return nil, err
	}
	out := []BranchInfo{}
	for _, line := range strings.Split(strings.TrimSpace(string(res.Stdout)), "\n") {
		f := strings.Split(line, "\x1f")
		if len(f) < 5 || strings.HasSuffix(f[0], "/HEAD") {
			continue
		}
		b := BranchInfo{Name: f[1], Current: f[2] == "*", Upstream: f[3],
			Remote: strings.HasPrefix(f[0], "refs/remotes/")}
		b.Time, _ = strconv.ParseInt(f[4], 10, 64)
		out = append(out, b)
	}
	return out, nil
}

// Checkout switches to a branch. A remote branch ("origin/x") creates a local
// tracking branch "x". create makes a new branch from HEAD.
func (s *Service) Checkout(ctx context.Context, repo, branch string, create bool) error {
	branch = strings.TrimSpace(branch)
	if branch == "" || strings.HasPrefix(branch, "-") {
		return apperr.BadRequest("invalid branch name")
	}
	if create {
		_, err := s.R.run(ctx, repo, runOpts{write: true}, "switch", "-c", branch)
		return err
	}
	if _, err := s.R.run(ctx, repo, runOpts{}, "show-ref", "--verify", "-q", "refs/heads/"+branch); err == nil {
		_, err := s.R.run(ctx, repo, runOpts{write: true}, "switch", branch)
		return err
	}
	if _, err := s.R.run(ctx, repo, runOpts{}, "show-ref", "--verify", "-q", "refs/remotes/"+branch); err == nil {
		_, err := s.R.run(ctx, repo, runOpts{write: true}, "switch", "--track", branch)
		return err
	}
	_, err := s.R.run(ctx, repo, runOpts{write: true}, "switch", branch)
	return err
}

type Stash struct {
	Ref     string `json:"ref"`
	Message string `json:"message"`
	Time    int64  `json:"time"`
}

func (s *Service) Stashes(ctx context.Context, repo string) ([]Stash, error) {
	res, err := s.R.run(ctx, repo, runOpts{}, "stash", "list", "--format=%gd%x1f%gs%x1f%ct")
	if err != nil {
		return nil, err
	}
	out := []Stash{}
	for _, line := range strings.Split(strings.TrimSpace(string(res.Stdout)), "\n") {
		f := strings.Split(line, "\x1f")
		if len(f) < 3 {
			continue
		}
		t, _ := strconv.ParseInt(f[2], 10, 64)
		out = append(out, Stash{Ref: f[0], Message: f[1], Time: t})
	}
	return out, nil
}

func (s *Service) StashAction(ctx context.Context, repo, action, ref, message string) (*RemoteResult, error) {
	var args []string
	switch action {
	case "push":
		args = []string{"stash", "push", "--include-untracked"}
		if message = strings.TrimSpace(message); message != "" {
			args = append(args, "-m", message)
		}
	case "pop", "apply", "drop":
		if !strings.HasPrefix(ref, "stash@{") {
			return nil, apperr.BadRequest("invalid stash ref")
		}
		args = []string{"stash", action, ref}
	default:
		return nil, apperr.BadRequest("unknown stash action")
	}
	res, err := s.R.run(ctx, repo, runOpts{write: true}, args...)
	if err != nil {
		return nil, err
	}
	return &RemoteResult{Output: strings.TrimSpace(string(res.Stdout) + "\n" + res.Stderr)}, nil
}

// FindRepo walks up from dir to the nearest directory containing .git, giving
// up once allowed(d) is false or the filesystem root is reached.
func FindRepo(dir string, allowed func(string) bool) string {
	for d := dir; allowed(d); d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, ".git")); err == nil {
			return d
		}
		if filepath.Dir(d) == d {
			break
		}
	}
	return ""
}
