package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"nanoditor/internal/apperr"
	"nanoditor/internal/auth"
	"nanoditor/internal/store"
)

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"identity": auth.FromContext(r.Context()),
		"version":  s.Cfg.Version,
		"home":     s.Cfg.Home,
		"roots":    s.Box.Roots(),
		"terminal": s.Term != nil,
	})
}

func (s *Server) settings() (store.Settings, error) {
	return s.Store.Settings()
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	set, err := s.settings()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, set)
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var in store.Settings
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	switch in.Theme {
	case "light", "dark", "system":
	default:
		in.Theme = "system"
	}
	if err := s.Store.SaveSettings(in); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, in)
}

func (s *Server) resolveDir(p string) (string, error) {
	real, err := s.Box.Resolve(p)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(real)
	if err != nil || !st.IsDir() {
		return "", apperr.BadRequest("not a folder").WithDetail(p)
	}
	return real, nil
}

func (s *Server) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	ws, err := s.Store.Workspaces()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, ws)
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	p, err := s.resolveDir(in.Path)
	if err != nil {
		writeErr(w, err)
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = filepath.Base(p)
	}
	ws, err := s.Store.UpsertWorkspace(name, p)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, ws)
}

func (s *Server) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, apperr.BadRequest("bad id"))
		return
	}
	var in struct {
		Name     *string                  `json:"name"`
		Settings *store.WorkspaceSettings `json:"settings"`
		Touch    bool                     `json:"touch"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	if in.Settings != nil {
		if err := s.cleanWorkspaceSettings(in.Settings); err != nil {
			writeErr(w, err)
			return
		}
	}
	if err := s.Store.UpdateWorkspace(id, in.Name, in.Settings, in.Touch); err != nil {
		writeErr(w, err)
		return
	}
	ws, err := s.Store.Workspace(id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, ws)
}

func (s *Server) cleanWorkspaceSettings(set *store.WorkspaceSettings) error {
	if set.ScanDepth < 1 || set.ScanDepth > 6 {
		set.ScanDepth = 3
	}
	return nil
}

// workspaceByID loads the workspace named by a client-supplied id.
func (s *Server) workspaceByID(raw string) (store.Workspace, error) {
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return store.Workspace{}, apperr.BadRequest("workspace id is required")
	}
	ws, err := s.Store.Workspace(id)
	if err != nil {
		return ws, apperr.NotFound("no such workspace")
	}
	return ws, nil
}

func (s *Server) deleteWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, apperr.BadRequest("bad id"))
		return
	}
	if err := s.Store.DeleteWorkspace(id); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) listRecents(w http.ResponseWriter, r *http.Request) {
	recents, err := s.Store.Recents(r.URL.Query().Get("kind"), 30)
	if err != nil {
		writeErr(w, err)
		return
	}
	// Drop entries whose files have since disappeared.
	out := recents[:0]
	for _, rc := range recents {
		if _, err := os.Stat(rc.Path); err == nil {
			out = append(out, rc)
		} else {
			_ = s.Store.RemoveRecent(rc.Path)
		}
	}
	writeJSON(w, out)
}

func (s *Server) touchRecent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path string `json:"path"`
		Kind string `json:"kind"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	p, err := s.Box.Resolve(in.Path)
	if err != nil {
		writeErr(w, err)
		return
	}
	if in.Kind != "note" {
		in.Kind = "file"
	}
	if err := s.Store.TouchRecent(p, in.Kind); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}
