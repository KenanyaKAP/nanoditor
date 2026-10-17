package httpapi

import (
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kennycode/internal/gitx"
)

func (s *Server) fsList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	set, err := s.settings()
	if err != nil {
		writeErr(w, err)
		return
	}
	hidden := set.ShowHidden
	if v := q.Get("hidden"); v != "" {
		hidden = v == "1"
	}
	l, err := s.FS.List(q.Get("path"), hidden, q.Get("dirs") == "1")
	if err != nil {
		writeErr(w, err)
		return
	}
	resp := map[string]any{"listing": l}
	if q.Get("git") == "1" {
		if repo := gitx.FindRepo(l.Path, s.Box.Contains); repo != "" {
			resp["repo"] = repo
			if st, err := s.Git.Status(r.Context(), repo); err == nil {
				resp["branch"] = st.Branch.Head
				markGit(l.Entries, repo, l.Path, st)
			}
		}
	}
	writeJSON(w, resp)
}

// markGit annotates directory entries with a git status letter. Folders that
// contain changes get "•".
func markGit(entries []fsEntry, repo, dir string, st *gitx.Status) {
	rel, err := filepath.Rel(repo, dir)
	if err != nil {
		return
	}
	prefix := ""
	if rel != "." {
		prefix = filepath.ToSlash(rel) + "/"
	}
	marks := map[string]string{}
	set := func(path, letter string) {
		if !strings.HasPrefix(path, prefix) {
			return
		}
		rest := strings.TrimPrefix(path, prefix)
		child, _, nested := strings.Cut(rest, "/")
		if nested {
			if marks[child] == "" {
				marks[child] = "•"
			}
			return
		}
		if cur := marks[child]; cur == "" || cur == "•" || letter == "U" {
			marks[child] = letter
		}
	}
	for _, f := range st.Untracked {
		set(f.Path, "?")
	}
	for _, f := range st.Staged {
		set(f.Path, f.X)
	}
	for _, f := range st.Changes {
		set(f.Path, f.Y)
	}
	for _, f := range st.Conflicts {
		set(f.Path, "U")
	}
	for i := range entries {
		if m, ok := marks[entries[i].Name]; ok {
			entries[i].Git = m
		}
	}
}

func (s *Server) fsRead(w http.ResponseWriter, r *http.Request) {
	fc, err := s.FS.Read(r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, fc)
}

func (s *Server) fsRaw(w http.ResponseWriter, r *http.Request) {
	if err := s.FS.Raw(w, r, r.URL.Query().Get("path")); err != nil {
		writeErr(w, err)
	}
}

func (s *Server) fsWrite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Etag    string `json:"etag"`
		Force   bool   `json:"force"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	res, err := s.FS.Write(in.Path, in.Content, in.Etag, in.Force)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.invalidateRepoOf(res.Path)
	writeJSON(w, res)
}

func (s *Server) fsCreate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
		Type string `json:"type"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	p, err := s.FS.Create(in.Path, in.Type)
	if err != nil {
		writeErr(w, err)
		return
	}
	s.invalidateRepoOf(p)
	writeJSON(w, map[string]string{"path": p})
}

func (s *Server) fsRename(w http.ResponseWriter, r *http.Request) {
	var in struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	p, err := s.FS.Rename(in.From, in.To)
	if err != nil {
		writeErr(w, err)
		return
	}
	_ = s.Store.RemoveRecent(in.From)
	s.invalidateRepoOf(p)
	writeJSON(w, map[string]string{"path": p})
}

func (s *Server) fsDelete(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	trashed, err := s.FS.Trash(in.Path)
	if err != nil {
		writeErr(w, err)
		return
	}
	_ = s.Store.RemoveRecent(in.Path)
	s.invalidateRepoOf(filepath.Dir(in.Path))
	writeJSON(w, map[string]string{"trashedTo": trashed})
}

func (s *Server) fsSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	res, err := s.FS.Search(r.Context(), q.Get("root"), q.Get("q"), q.Get("mode"), limit)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, res)
}

func (s *Server) invalidateRepoOf(p string) {
	if repo := gitx.FindRepo(filepath.Dir(p), s.Box.Contains); repo != "" {
		gitx.Invalidate(repo)
	}
}

func (s *Server) notesConfig() (notesCfg, error) {
	set, err := s.settings()
	if err != nil {
		return notesCfg{}, err
	}
	return notesCfg{Root: set.NotesRoot, DailyFolder: set.DailyFolder, InboxFile: set.InboxFile}, nil
}

func (s *Server) notesRecent(w http.ResponseWriter, r *http.Request) {
	c, err := s.notesConfig()
	if err != nil {
		writeErr(w, err)
		return
	}
	list, err := s.Notes.Recent(r.Context(), c, 30)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, list)
}

func (s *Server) notesCapture(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text   string `json:"text"`
		Target string `json:"target"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	c, err := s.notesConfig()
	if err != nil {
		writeErr(w, err)
		return
	}
	res, err := s.Notes.Capture(c, in.Target, in.Text, time.Now())
	if err != nil {
		writeErr(w, err)
		return
	}
	s.invalidateRepoOf(res.Path)
	writeJSON(w, res)
}

func (s *Server) notesDaily(w http.ResponseWriter, r *http.Request) {
	c, err := s.notesConfig()
	if err != nil {
		writeErr(w, err)
		return
	}
	p, err := s.Notes.Daily(c, time.Now())
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]string{"path": p})
}

func (s *Server) notesResolve(w http.ResponseWriter, r *http.Request) {
	c, err := s.notesConfig()
	if err != nil {
		writeErr(w, err)
		return
	}
	p, err := s.Notes.Resolve(r.Context(), c, r.URL.Query().Get("name"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]string{"path": p})
}
