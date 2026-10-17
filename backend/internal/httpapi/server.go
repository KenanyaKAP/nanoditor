// Package httpapi exposes the services as a JSON API and serves the web app.
package httpapi

import (
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"kennycode/internal/apperr"
	"kennycode/internal/auth"
	"kennycode/internal/config"
	"kennycode/internal/fsapi"
	"kennycode/internal/gitx"
	"kennycode/internal/notes"
	"kennycode/internal/pathsafe"
	"kennycode/internal/store"
)

type Server struct {
	Cfg   config.Config
	Store *store.Store
	Box   *pathsafe.Sandbox
	FS    *fsapi.Service
	Notes *notes.Service
	Git   *gitx.Service
	Auth  *auth.Middleware
	Web   fs.FS // built frontend (dist)
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	// No RealIP middleware: RemoteAddr must be the true peer, because the
	// Tailscale WhoIs check trusts it.
	r.Use(middleware.Recoverer)
	r.Use(requestLog)

	r.Get("/api/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true})
	})

	r.Group(func(r chi.Router) {
		r.Use(s.Auth.Handler)
		r.Use(middleware.NoCache)

		r.Get("/api/me", s.me)
		r.Get("/api/settings", s.getSettings)
		r.Put("/api/settings", s.putSettings)

		r.Get("/api/workspaces", s.listWorkspaces)
		r.Post("/api/workspaces", s.createWorkspace)
		r.Patch("/api/workspaces/{id}", s.updateWorkspace)
		r.Delete("/api/workspaces/{id}", s.deleteWorkspace)

		r.Get("/api/recents", s.listRecents)
		r.Post("/api/recents", s.touchRecent)

		r.Get("/api/fs/list", s.fsList)
		r.Get("/api/fs/read", s.fsRead)
		r.Get("/api/fs/raw", s.fsRaw)
		r.Put("/api/fs/write", s.fsWrite)
		r.Post("/api/fs/create", s.fsCreate)
		r.Post("/api/fs/rename", s.fsRename)
		r.Post("/api/fs/delete", s.fsDelete)
		r.Get("/api/fs/search", s.fsSearch)

		r.Get("/api/notes/recent", s.notesRecent)
		r.Post("/api/notes/capture", s.notesCapture)
		r.Post("/api/notes/daily", s.notesDaily)
		r.Get("/api/notes/resolve", s.notesResolve)
		r.Get("/api/notes/detect", s.notesDetect)

		r.Get("/api/git/repos", s.gitRepos)
		r.Get("/api/git/status", s.gitStatus)
		r.Get("/api/git/diff", s.gitDiff)
		r.Post("/api/git/stage", s.gitStage)
		r.Post("/api/git/unstage", s.gitUnstage)
		r.Post("/api/git/discard", s.gitDiscard)
		r.Post("/api/git/hunk", s.gitHunk)
		r.Post("/api/git/commit", s.gitCommit)
		r.Get("/api/git/messages", s.gitMessages)
		r.Post("/api/git/fetch", s.gitFetch)
		r.Post("/api/git/pull", s.gitPull)
		r.Post("/api/git/push", s.gitPush)
		r.Get("/api/git/log", s.gitLog)
		r.Get("/api/git/show", s.gitShow)
		r.Get("/api/git/branches", s.gitBranches)
		r.Post("/api/git/checkout", s.gitCheckout)
		r.Get("/api/git/stash", s.gitStashes)
		r.Post("/api/git/stash", s.gitStashAction)
	})

	r.NotFound(s.Auth.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeErr(w, apperr.NotFound("no such endpoint"))
			return
		}
		s.serveWeb(w, r)
	})).ServeHTTP)
	return r
}

// serveWeb serves the SPA: real files when present, index.html otherwise.
func (s *Server) serveWeb(w http.ResponseWriter, r *http.Request) {
	if s.Web == nil {
		http.Error(w, "frontend not built", http.StatusNotFound)
		return
	}
	p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if p != "" && p != "index.html" {
		if f, err := s.Web.Open(p); err == nil {
			st, _ := f.Stat()
			f.Close()
			if st != nil && !st.IsDir() {
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					w.Header().Set("Cache-Control", "no-cache")
				}
				http.ServeFileFS(w, r, s.Web, p)
				return
			}
		}
	}
	idx, err := fs.ReadFile(s.Web, "index.html")
	if err != nil {
		http.Error(w, "frontend not built", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(idx)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	e := apperr.From(err)
	if e.Status >= 500 {
		log.Printf("error: %v", e)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": e})
}

// WriteDenied is the auth middleware's deny hook.
func WriteDenied(w http.ResponseWriter, e *apperr.Error) { writeErr(w, e) }

func decode(r *http.Request, v any) error {
	ct := r.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		return apperr.BadRequest("expected application/json")
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 16<<20))
	if err := dec.Decode(v); err != nil {
		return apperr.BadRequest("invalid JSON body").WithDetail(err.Error())
	}
	return nil
}

func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/healthz" {
			log.Printf("%s %s %d %s %s", r.Method, r.URL.Path, ww.Status(), time.Since(start).Round(time.Millisecond), r.RemoteAddr)
		}
	})
}
