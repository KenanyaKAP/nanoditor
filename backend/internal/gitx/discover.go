package gitx

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"nanoditor/internal/fsapi"
)

type RepoSummary struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Root       string `json:"root"`
	Branch     Branch `json:"branch"`
	Staged     int    `json:"staged"`
	Unstaged   int    `json:"unstaged"`
	Untracked  int    `json:"untracked"`
	Conflicted int    `json:"conflicted"`
	LastCommit *struct {
		Short   string `json:"short"`
		Subject string `json:"subject"`
		Time    int64  `json:"time"`
	} `json:"lastCommit,omitempty"`
	Error string `json:"error,omitempty"`
}

func (r RepoSummary) Dirty() bool {
	return r.Staged+r.Unstaged+r.Untracked+r.Conflicted > 0
}

// Discover finds git repositories under root, up to depth levels deep. It does
// not descend into a repository once found, nor into hidden or vendor dirs.
func Discover(root string, depth int) []string {
	var repos []string
	var walk func(dir string, level int)
	walk = func(dir string, level int) {
		if isRepo(dir) {
			repos = append(repos, dir)
			return
		}
		if level >= depth {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			name := e.Name()
			if !e.IsDir() || strings.HasPrefix(name, ".") || fsapi.SkipDirs[name] {
				continue
			}
			walk(filepath.Join(dir, name), level+1)
		}
	}
	walk(root, 0)
	return repos
}

func isRepo(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

type summaryCache struct {
	mu    sync.Mutex
	items map[string]cachedSummary
}

type cachedSummary struct {
	s   RepoSummary
	exp time.Time
}

var cache = summaryCache{items: map[string]cachedSummary{}}

// Invalidate drops a repo's cached summary after a mutation.
func Invalidate(repo string) {
	cache.mu.Lock()
	delete(cache.items, repo)
	cache.mu.Unlock()
}

func (s *Service) Summaries(ctx context.Context, roots []string, depth int, fresh bool) []RepoSummary {
	type job struct{ path, root string }
	var jobs []job
	seen := map[string]bool{}
	for _, root := range roots {
		for _, p := range Discover(root, depth) {
			if !seen[p] {
				seen[p] = true
				jobs = append(jobs, job{p, root})
			}
		}
	}
	out := make([]RepoSummary, len(jobs))
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for i, j := range jobs {
		wg.Add(1)
		go func(i int, j job) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			out[i] = s.summary(ctx, j.path, j.root, fresh)
		}(i, j)
	}
	wg.Wait()
	sort.SliceStable(out, func(a, b int) bool {
		if da, db := out[a].Dirty(), out[b].Dirty(); da != db {
			return da
		}
		return strings.ToLower(out[a].Name) < strings.ToLower(out[b].Name)
	})
	return out
}

func (s *Service) summary(ctx context.Context, path, root string, fresh bool) RepoSummary {
	if !fresh {
		cache.mu.Lock()
		c, ok := cache.items[path]
		cache.mu.Unlock()
		if ok && time.Now().Before(c.exp) {
			return c.s
		}
	}
	rel, _ := filepath.Rel(root, path)
	if rel == "." {
		rel = filepath.Base(path)
	}
	sum := RepoSummary{Path: path, Name: rel, Root: root}
	st, err := s.Status(ctx, path)
	if err != nil {
		sum.Error = err.Error()
		return sum
	}
	sum.Branch = st.Branch
	sum.Staged, sum.Unstaged = len(st.Staged), len(st.Changes)
	sum.Untracked, sum.Conflicted = len(st.Untracked), len(st.Conflicts)
	if st.Branch.Oid != "" {
		if res, err := s.R.run(ctx, path, runOpts{}, "log", "-1", "--format=%h%x1f%s%x1f%ct"); err == nil {
			f := strings.Split(strings.TrimSpace(string(res.Stdout)), "\x1f")
			if len(f) == 3 {
				t, _ := strconv.ParseInt(f[2], 10, 64)
				sum.LastCommit = &struct {
					Short   string `json:"short"`
					Subject string `json:"subject"`
					Time    int64  `json:"time"`
				}{f[0], f[1], t}
			}
		}
	}
	cache.mu.Lock()
	cache.items[path] = cachedSummary{s: sum, exp: time.Now().Add(10 * time.Second)}
	cache.mu.Unlock()
	return sum
}
