package httpapi

import (
	"context"
	"net/http"
	"path/filepath"
	"strconv"

	"kennycode/internal/apperr"
	"kennycode/internal/fsapi"
	"kennycode/internal/gitx"
	"kennycode/internal/notes"
)

type (
	fsEntry  = fsapi.Entry
	notesCfg = notes.Config
)

// repo validates a repo path from the client: inside the sandbox and the
// top level of a git work tree.
func (s *Server) repo(ctx context.Context, p string) (string, error) {
	real, err := s.Box.Resolve(p)
	if err != nil {
		return "", err
	}
	top, err := s.Git.Toplevel(ctx, real)
	if err != nil {
		return "", err
	}
	if top, err = filepath.EvalSymlinks(top); err != nil {
		return "", err
	}
	if top != real || !s.Box.Contains(top) {
		return "", apperr.BadRequest("not the top level of a git repository").WithDetail(p)
	}
	return top, nil
}

// repoPaths checks client-supplied repo-relative paths don't escape the repo.
func repoPaths(repo string, paths []string) error {
	for _, p := range paths {
		if p == "" || filepath.IsAbs(p) {
			return apperr.BadRequest("paths must be relative to the repo")
		}
		full := filepath.Join(repo, p)
		if full != repo && !hasPrefixDir(full, repo) {
			return apperr.BadRequest("path escapes the repo").WithDetail(p)
		}
	}
	return nil
}

func hasPrefixDir(p, dir string) bool {
	return len(p) > len(dir) && p[:len(dir)] == dir && p[len(dir)] == filepath.Separator
}

type repoReq struct {
	Repo string `json:"repo"`
}

type pathsReq struct {
	Repo  string   `json:"repo"`
	Paths []string `json:"paths"`
}

func (s *Server) gitRepos(w http.ResponseWriter, r *http.Request) {
	set, err := s.settings()
	if err != nil {
		writeErr(w, err)
		return
	}
	var roots []string
	for _, g := range set.GitRoots {
		if p, err := s.Box.Resolve(g); err == nil {
			roots = append(roots, p)
		}
	}
	repos := s.Git.Summaries(r.Context(), roots, set.ScanDepth, r.URL.Query().Get("fresh") == "1")
	if repos == nil {
		repos = []gitx.RepoSummary{}
	}
	writeJSON(w, map[string]any{"roots": roots, "repos": repos})
}

func (s *Server) gitStatus(w http.ResponseWriter, r *http.Request) {
	repo, err := s.repo(r.Context(), r.URL.Query().Get("repo"))
	if err != nil {
		writeErr(w, err)
		return
	}
	st, err := s.Git.Status(r.Context(), repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]any{"repo": repo, "name": filepath.Base(repo), "status": st})
}

func (s *Server) gitDiff(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	repo, err := s.repo(r.Context(), q.Get("repo"))
	if err != nil {
		writeErr(w, err)
		return
	}
	path := q.Get("path")
	if err := repoPaths(repo, []string{path}); err != nil {
		writeErr(w, err)
		return
	}
	d, err := s.Git.Diff(r.Context(), repo, path, q.Get("staged") == "1", q.Get("untracked") == "1")
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, d)
}

func (s *Server) withPaths(w http.ResponseWriter, r *http.Request, fn func(ctx context.Context, repo string, paths []string) error) {
	var in pathsReq
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	repo, err := s.repo(r.Context(), in.Repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := repoPaths(repo, in.Paths); err != nil {
		writeErr(w, err)
		return
	}
	defer gitx.Invalidate(repo)
	if err := fn(r.Context(), repo, in.Paths); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) gitStage(w http.ResponseWriter, r *http.Request)   { s.withPaths(w, r, s.Git.Stage) }
func (s *Server) gitUnstage(w http.ResponseWriter, r *http.Request) { s.withPaths(w, r, s.Git.Unstage) }

func (s *Server) gitDiscard(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo      string   `json:"repo"`
		Paths     []string `json:"paths"`
		Untracked []string `json:"untracked"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	repo, err := s.repo(r.Context(), in.Repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := repoPaths(repo, append(append([]string{}, in.Paths...), in.Untracked...)); err != nil {
		writeErr(w, err)
		return
	}
	defer gitx.Invalidate(repo)
	if len(in.Paths) > 0 {
		if err := s.Git.Discard(r.Context(), repo, in.Paths); err != nil {
			writeErr(w, err)
			return
		}
	}
	for _, p := range in.Untracked {
		if _, err := s.FS.Trash(filepath.Join(repo, p)); err != nil {
			writeErr(w, err)
			return
		}
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) gitHunk(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo   string `json:"repo"`
		Path   string `json:"path"`
		HunkID string `json:"hunkId"`
		Action string `json:"action"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	repo, err := s.repo(r.Context(), in.Repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := repoPaths(repo, []string{in.Path}); err != nil {
		writeErr(w, err)
		return
	}
	defer gitx.Invalidate(repo)
	if err := s.Git.ApplyHunk(r.Context(), repo, in.Path, in.HunkID, in.Action); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) gitCommit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo    string `json:"repo"`
		Message string `json:"message"`
		Amend   bool   `json:"amend"`
		Push    bool   `json:"push"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	repo, err := s.repo(r.Context(), in.Repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer gitx.Invalidate(repo)
	res, err := s.Git.Commit(r.Context(), repo, in.Message, in.Amend)
	if err != nil {
		writeErr(w, err)
		return
	}
	if in.Message != "" {
		_ = s.Store.AddCommitMessage(repo, in.Message)
	}
	resp := map[string]any{"commit": res}
	if in.Push {
		if pr, err := s.Git.Push(r.Context(), repo); err != nil {
			resp["pushError"] = apperr.From(err)
		} else {
			resp["push"] = pr
		}
	}
	writeJSON(w, resp)
}

func (s *Server) gitMessages(w http.ResponseWriter, r *http.Request) {
	msgs, err := s.Store.CommitMessages(r.URL.Query().Get("repo"), 15)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, msgs)
}

func (s *Server) remoteOp(w http.ResponseWriter, r *http.Request, fn func(ctx context.Context, repo string, rebase bool) (*gitx.RemoteResult, error)) {
	var in struct {
		Repo   string `json:"repo"`
		Rebase bool   `json:"rebase"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	repo, err := s.repo(r.Context(), in.Repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer gitx.Invalidate(repo)
	res, err := fn(r.Context(), repo, in.Rebase)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, res)
}

func (s *Server) gitFetch(w http.ResponseWriter, r *http.Request) {
	s.remoteOp(w, r, func(ctx context.Context, repo string, _ bool) (*gitx.RemoteResult, error) {
		return s.Git.Fetch(ctx, repo)
	})
}

func (s *Server) gitPull(w http.ResponseWriter, r *http.Request) { s.remoteOp(w, r, s.Git.Pull) }

func (s *Server) gitPush(w http.ResponseWriter, r *http.Request) {
	s.remoteOp(w, r, func(ctx context.Context, repo string, _ bool) (*gitx.RemoteResult, error) {
		return s.Git.Push(ctx, repo)
	})
}

func (s *Server) gitLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	repo, err := s.repo(r.Context(), q.Get("repo"))
	if err != nil {
		writeErr(w, err)
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	skip, _ := strconv.Atoi(q.Get("skip"))
	commits, err := s.Git.Log(r.Context(), repo, limit, max(skip, 0))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, commits)
}

func (s *Server) gitShow(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	repo, err := s.repo(r.Context(), q.Get("repo"))
	if err != nil {
		writeErr(w, err)
		return
	}
	d, err := s.Git.Show(r.Context(), repo, q.Get("rev"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, d)
}

func (s *Server) gitBranches(w http.ResponseWriter, r *http.Request) {
	repo, err := s.repo(r.Context(), r.URL.Query().Get("repo"))
	if err != nil {
		writeErr(w, err)
		return
	}
	b, err := s.Git.Branches(r.Context(), repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, b)
}

func (s *Server) gitCheckout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo   string `json:"repo"`
		Branch string `json:"branch"`
		Create bool   `json:"create"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	repo, err := s.repo(r.Context(), in.Repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer gitx.Invalidate(repo)
	if err := s.Git.Checkout(r.Context(), repo, in.Branch, in.Create); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) gitStashes(w http.ResponseWriter, r *http.Request) {
	repo, err := s.repo(r.Context(), r.URL.Query().Get("repo"))
	if err != nil {
		writeErr(w, err)
		return
	}
	st, err := s.Git.Stashes(r.Context(), repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, st)
}

func (s *Server) gitStashAction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo    string `json:"repo"`
		Action  string `json:"action"`
		Ref     string `json:"ref"`
		Message string `json:"message"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	repo, err := s.repo(r.Context(), in.Repo)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer gitx.Invalidate(repo)
	res, err := s.Git.StashAction(r.Context(), repo, in.Action, in.Ref, in.Message)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, res)
}
