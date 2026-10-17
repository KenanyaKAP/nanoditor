package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"

	"nanoditor/internal/apperr"
	"nanoditor/internal/term"
)

// terminal returns the terminal manager, or answers 404 when it is off.
func (s *Server) terminal(w http.ResponseWriter) *term.Manager {
	if s.Term == nil {
		writeErr(w, apperr.NotFound("the terminal is off; set TERMINAL=on in .env"))
	}
	return s.Term
}

func (s *Server) termStatus(w http.ResponseWriter, r *http.Request) {
	t := s.terminal(w)
	if t == nil {
		return
	}
	st, err := t.Status()
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, st)
}

func (s *Server) termCheck(w http.ResponseWriter, r *http.Request) {
	t := s.terminal(w)
	if t == nil {
		return
	}
	if err := t.Check(); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) termStart(w http.ResponseWriter, r *http.Request) {
	t := s.terminal(w)
	if t == nil {
		return
	}
	var in struct {
		Cwd  string `json:"cwd"`
		Cols int    `json:"cols"`
		Rows int    `json:"rows"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	// Only a folder the app may open; otherwise the shell starts at home.
	cwd := ""
	if in.Cwd != "" {
		if dir, err := s.resolveDir(in.Cwd); err == nil {
			cwd = dir
		}
	}
	sess, err := t.Start(cwd, in.Cols, in.Rows)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, sess)
}

func (s *Server) termClose(w http.ResponseWriter, r *http.Request) {
	t := s.terminal(w)
	if t == nil {
		return
	}
	if sess := t.Get(chi.URLParam(r, "id")); sess != nil {
		sess.Close()
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// termSocket streams a session: binary frames carry terminal bytes both
// ways; text frames carry control messages ({"type":"resize"} in,
// {"type":"exit"} out). On connect it replays recent output first.
func (s *Server) termSocket(w http.ResponseWriter, r *http.Request) {
	t := s.terminal(w)
	if t == nil {
		return
	}
	sess := t.Get(chi.URLParam(r, "id"))
	if sess == nil {
		writeErr(w, apperr.NotFound("no such terminal"))
		return
	}
	// Browsers can't add the X-ND header to a WebSocket, so the CSRF guard
	// here is Accept's same-origin check on the Origin header.
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 20)

	// The request context ends with the handshake; the socket lives on.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	replay, out, detach := sess.Attach()
	defer detach()

	go func() {
		defer cancel()
		for {
			typ, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			if typ == websocket.MessageBinary {
				if sess.Write(data) != nil {
					return
				}
				continue
			}
			var msg struct {
				Type       string `json:"type"`
				Cols, Rows int
			}
			if json.Unmarshal(data, &msg) == nil && msg.Type == "resize" {
				_ = sess.Resize(msg.Cols, msg.Rows)
			}
		}
	}()

	if len(replay) > 0 && c.Write(ctx, websocket.MessageBinary, replay) != nil {
		return
	}
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			pctx, pcancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.Ping(pctx)
			pcancel()
			if err != nil {
				return
			}
		case data, ok := <-out:
			if !ok {
				if sess.Exited() {
					_ = c.Write(ctx, websocket.MessageText, []byte(`{"type":"exit"}`))
					c.Close(websocket.StatusNormalClosure, "shell exited")
				}
				return
			}
			if c.Write(ctx, websocket.MessageBinary, data) != nil {
				return
			}
		}
	}
}
