// Package term runs terminal sessions on the host over SSH to localhost, so
// they get the user's own login shell and environment (fish, PATH, tools)
// even though the app itself runs in a container.
//
// The app never changes SSH access itself: it makes its own key and shows the
// line the user adds to ~/.ssh/authorized_keys to allow it.
//
// Sessions outlive the browser connection: a phone that locks or switches
// apps drops its WebSocket, and reattaching replays recent output.
package term

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"nanoditor/internal/apperr"
)

const (
	maxSessions = 8
	// Output kept per session for reattaching.
	maxReplay  = 256 << 10
	keyComment = "nanoditor-terminal"
)

type Config struct {
	Addr    string // host sshd, e.g. 127.0.0.1:22
	User    string // account to log in as
	Home    string // where ~/.ssh/authorized_keys lives
	DataDir string // the app's key and the pinned host key
}

type Manager struct {
	cfg Config

	mu       sync.Mutex
	signer   ssh.Signer
	sessions map[string]*Session
}

func NewManager(cfg Config) *Manager {
	return &Manager{cfg: cfg, sessions: map[string]*Session{}}
}

// Status says whether the user has authorized the app's key yet, and gives
// the line to add if not.
type Status struct {
	Authorized    bool       `json:"authorized"`
	User          string     `json:"user"`
	Addr          string     `json:"addr"`
	AuthorizedKey string     `json:"authorizedKey"` // line for ~/.ssh/authorized_keys
	Sessions      []*Session `json:"sessions"`
}

func (m *Manager) Status() (Status, error) {
	st := Status{User: m.cfg.User, Addr: m.cfg.Addr, Sessions: m.List()}
	signer, err := m.key()
	if err != nil {
		return st, err
	}
	// Limited to connections from this machine, and to a shell only.
	st.AuthorizedKey = `from="127.0.0.1,::1",no-port-forwarding,no-agent-forwarding,no-X11-forwarding ` +
		strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey()))) + " " + keyComment
	data, err := os.ReadFile(filepath.Join(m.cfg.Home, ".ssh", "authorized_keys"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return st, err
	}
	st.Authorized = bytes.Contains(data, []byte(keyBlob(signer)))
	return st, nil
}

// Check connects once, which also pins the host key, so setup problems show
// up with a clear message instead of on the first terminal.
func (m *Manager) Check() error {
	c, err := m.dial()
	if err != nil {
		return err
	}
	return c.Close()
}

// key loads the app's own SSH key, creating it on first use.
func (m *Manager) key() (ssh.Signer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.signer != nil {
		return m.signer, nil
	}
	path := filepath.Join(m.cfg.DataDir, "terminal_ed25519")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		_, priv, gerr := ed25519.GenerateKey(rand.Reader)
		if gerr != nil {
			return nil, gerr
		}
		block, merr := ssh.MarshalPrivateKey(priv, keyComment)
		if merr != nil {
			return nil, merr
		}
		data = pem.EncodeToMemory(block)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	signer, err := ssh.ParsePrivateKey(data)
	if err != nil {
		return nil, fmt.Errorf("terminal key %s: %w", path, err)
	}
	m.signer = signer
	return signer, nil
}

// keyBlob is the base64 part of a public key, which identifies it in
// authorized_keys whatever options or comment surround it.
func keyBlob(s ssh.Signer) string {
	return strings.Fields(string(ssh.MarshalAuthorizedKey(s.PublicKey())))[1]
}

// hostKey pins the host's key on first connection (this machine, over
// loopback) and refuses a different one afterwards.
func (m *Manager) hostKey(_ string, _ net.Addr, key ssh.PublicKey) error {
	path := filepath.Join(m.cfg.DataDir, "terminal_host_key")
	want, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return os.WriteFile(path, ssh.MarshalAuthorizedKey(key), 0o600)
	} else if err != nil {
		return err
	}
	pinned, _, _, _, err := ssh.ParseAuthorizedKey(want)
	if err != nil || !bytes.Equal(pinned.Marshal(), key.Marshal()) {
		return fmt.Errorf("the SSH host key of %s changed; delete %s if that was expected", m.cfg.Addr, path)
	}
	return nil
}

func (m *Manager) dial() (*ssh.Client, error) {
	signer, err := m.key()
	if err != nil {
		return nil, err
	}
	c, err := ssh.Dial("tcp", m.cfg.Addr, &ssh.ClientConfig{
		User:            m.cfg.User,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: m.hostKey,
		Timeout:         5 * time.Second,
	})
	if err != nil {
		if strings.Contains(err.Error(), "unable to authenticate") {
			return nil, apperr.New(http.StatusBadGateway, "ssh_auth",
				fmt.Sprintf("SSH on %s did not accept the key for %s", m.cfg.Addr, m.cfg.User)).WithDetail(err.Error())
		}
		return nil, apperr.New(http.StatusBadGateway, "ssh_unreachable",
			fmt.Sprintf("Could not connect to SSH on %s", m.cfg.Addr)).WithDetail(err.Error())
	}
	return c, nil
}

// Session is one shell on the host.
type Session struct {
	ID      string `json:"id"`
	Cwd     string `json:"cwd"`
	Created int64  `json:"created"`

	client *ssh.Client
	ssh    *ssh.Session
	stdin  io.Writer

	mu     sync.Mutex
	replay []byte
	subs   map[chan []byte]struct{}
	exited bool
}

// Start opens a login shell in cwd (the home folder if empty).
func (m *Manager) Start(cwd string, cols, rows int) (*Session, error) {
	m.mu.Lock()
	n := len(m.sessions)
	m.mu.Unlock()
	if n >= maxSessions {
		return nil, apperr.BadRequest(fmt.Sprintf("at most %d terminals at once", maxSessions))
	}
	client, err := m.dial()
	if err != nil {
		return nil, err
	}
	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, err
	}
	fail := func(err error) (*Session, error) {
		sess.Close()
		client.Close()
		return nil, err
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err := sess.RequestPty("xterm-256color", clamp(rows), clamp(cols), modes); err != nil {
		return fail(err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		return fail(err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return fail(err)
	}
	if err := sess.Start(shellCommand(cwd)); err != nil {
		return fail(err)
	}
	s := &Session{
		ID: newID(), Cwd: cwd, Created: time.Now().Unix(),
		client: client, ssh: sess, stdin: stdin, subs: map[chan []byte]struct{}{},
	}
	m.mu.Lock()
	m.sessions[s.ID] = s
	m.mu.Unlock()
	go func() {
		buf := make([]byte, 32<<10)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				s.emit(buf[:n])
			}
			if err != nil {
				break
			}
		}
		_ = sess.Wait()
		client.Close()
		m.mu.Lock()
		delete(m.sessions, s.ID)
		m.mu.Unlock()
		s.finish()
	}()
	return s, nil
}

// shellCommand starts the account's own login shell. sshd runs it through
// that same shell, so it must be valid in sh, bash, zsh and fish alike.
func shellCommand(cwd string) string {
	cmd := "exec $SHELL -l"
	if cwd != "" {
		cmd = "cd " + quote(cwd) + "; " + cmd
	}
	return cmd
}

// quote single-quotes s. An embedded quote closes the string, adds an
// escaped quote and reopens it, which POSIX shells and fish both accept.
func quote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func (m *Manager) Get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *Manager) List() []*Session {
	m.mu.Lock()
	out := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	m.mu.Unlock()
	sort.Slice(out, func(i, j int) bool {
		if out[i].Created != out[j].Created {
			return out[i].Created < out[j].Created
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (s *Session) emit(p []byte) {
	data := append([]byte(nil), p...)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.replay = append(s.replay, data...)
	if over := len(s.replay) - maxReplay; over > 0 {
		// Start the replay at a line boundary so it doesn't open mid-sequence.
		if i := bytes.IndexByte(s.replay[over:], '\n'); i >= 0 && i < 4096 {
			over += i + 1
		}
		s.replay = append([]byte(nil), s.replay[over:]...)
	}
	for ch := range s.subs {
		select {
		case ch <- data:
		default:
			// Too slow to keep up: drop it; it reattaches and gets the replay.
			delete(s.subs, ch)
			close(ch)
		}
	}
}

func (s *Session) finish() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.exited = true
	for ch := range s.subs {
		delete(s.subs, ch)
		close(ch)
	}
}

// Attach returns recent output and a channel of new output. The channel is
// closed when the shell exits or the viewer falls behind.
func (s *Session) Attach() (replay []byte, out <-chan []byte, detach func()) {
	ch := make(chan []byte, 256)
	s.mu.Lock()
	defer s.mu.Unlock()
	replay = append([]byte(nil), s.replay...)
	if s.exited {
		close(ch)
	} else {
		s.subs[ch] = struct{}{}
	}
	return replay, ch, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if _, ok := s.subs[ch]; ok {
			delete(s.subs, ch)
			close(ch)
		}
	}
}

func (s *Session) Exited() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exited
}

func (s *Session) Write(p []byte) error {
	_, err := s.stdin.Write(p)
	return err
}

func (s *Session) Resize(cols, rows int) error {
	return s.ssh.WindowChange(clamp(rows), clamp(cols))
}

// Close ends the shell and everything running in it.
func (s *Session) Close() {
	_ = s.ssh.Close()
	_ = s.client.Close()
}

func clamp(n int) int {
	return max(1, min(n, 1000))
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
