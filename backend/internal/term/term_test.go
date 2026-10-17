package term

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// fakeSSH is a minimal sshd: it accepts one public key, records the command
// it is asked to run, then echoes input back until it sees "exit".
type fakeSSH struct {
	addr string
	mu   sync.Mutex
	cmds []string
}

func startFakeSSH(t *testing.T, allowed func() ssh.PublicKey) *fakeSSH {
	t.Helper()
	_, hostPriv, _ := ed25519.GenerateKey(rand.Reader)
	hostKey, _ := ssh.NewSignerFromKey(hostPriv)
	cfg := &ssh.ServerConfig{
		PublicKeyCallback: func(_ ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
			if a := allowed(); a != nil && bytes.Equal(a.Marshal(), k.Marshal()) {
				return nil, nil
			}
			return nil, os.ErrPermission
		},
	}
	cfg.AddHostKey(hostKey)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	f := &fakeSSH{addr: ln.Addr().String()}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn, cfg)
		}
	}()
	return f
}

func (f *fakeSSH) serve(conn net.Conn, cfg *ssh.ServerConfig) {
	_, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		ch, reqs, err := nc.Accept()
		if err != nil {
			continue
		}
		go func() {
			for req := range reqs {
				if req.Type == "exec" {
					cmd := string(req.Payload[4:])
					f.mu.Lock()
					f.cmds = append(f.cmds, cmd)
					f.mu.Unlock()
					ch.Write([]byte("$ "))
				}
				req.Reply(req.Type == "exec" || req.Type == "pty-req" || req.Type == "window-change", nil)
			}
		}()
		go func() {
			buf := make([]byte, 1024)
			for {
				n, err := ch.Read(buf)
				if err != nil {
					return
				}
				if strings.Contains(string(buf[:n]), "exit") {
					ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
					ch.Close()
					return
				}
				ch.Write(buf[:n])
			}
		}()
	}
}

func recv(t *testing.T, out <-chan []byte, want string) {
	t.Helper()
	var got []byte
	deadline := time.After(3 * time.Second)
	for !bytes.Contains(got, []byte(want)) {
		select {
		case b, ok := <-out:
			if !ok {
				t.Fatalf("output closed before %q (got %q)", want, got)
			}
			got = append(got, b...)
		case <-deadline:
			t.Fatalf("timed out waiting for %q (got %q)", want, got)
		}
	}
}

func TestSessionLifecycle(t *testing.T) {
	home, data := t.TempDir(), t.TempDir()
	var m *Manager
	srv := startFakeSSH(t, func() ssh.PublicKey {
		if m == nil || m.signer == nil {
			return nil
		}
		return m.signer.PublicKey()
	})
	m = NewManager(Config{Addr: srv.addr, User: "me", Home: home, DataDir: data})

	st, err := m.Status()
	if err != nil || st.Authorized {
		t.Fatalf("status before authorizing = %+v, %v", st, err)
	}
	if !strings.HasPrefix(st.AuthorizedKey, `from="127.0.0.1,::1",no-port-forwarding`) {
		t.Errorf("authorized key line = %q", st.AuthorizedKey)
	}
	// What the user does by hand.
	os.MkdirAll(filepath.Join(home, ".ssh"), 0o700)
	os.WriteFile(filepath.Join(home, ".ssh", "authorized_keys"), []byte(st.AuthorizedKey+"\n"), 0o600)
	if st, _ = m.Status(); !st.Authorized {
		t.Fatal("not authorized after adding the line")
	}
	if err := m.Check(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(data, "terminal_host_key")); err != nil {
		t.Fatal("host key not pinned")
	}

	s, err := m.Start("/w/it's here", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if want := `cd '/w/it'\''s here'; exec $SHELL -l`; len(srv.cmds) != 1 || srv.cmds[0] != want {
		t.Errorf("command = %q, want %q", srv.cmds, want)
	}
	_, out, detach := s.Attach()
	recv(t, out, "$ ")
	s.Write([]byte("hello"))
	recv(t, out, "hello")
	detach()

	// Output while nobody watches is replayed on reattach.
	s.Write([]byte("while away"))
	time.Sleep(100 * time.Millisecond)
	replay, out, detach := s.Attach()
	defer detach()
	if !bytes.Contains(replay, []byte("hello")) || !bytes.Contains(replay, []byte("while away")) {
		t.Errorf("replay = %q", replay)
	}
	if err := s.Resize(120, 40); err != nil {
		t.Errorf("resize: %v", err)
	}

	s.Write([]byte("exit\n"))
	select {
	case _, ok := <-out:
		for ok {
			_, ok = <-out
		}
	case <-time.After(3 * time.Second):
		t.Fatal("output not closed after exit")
	}
	if !s.Exited() || len(m.List()) != 0 {
		t.Errorf("after exit: exited=%v sessions=%d", s.Exited(), len(m.List()))
	}
}

func TestHostKeyChangeIsRefused(t *testing.T) {
	home, data := t.TempDir(), t.TempDir()
	var m *Manager
	allow := func() ssh.PublicKey {
		if m == nil || m.signer == nil {
			return nil
		}
		return m.signer.PublicKey()
	}
	first := startFakeSSH(t, allow)
	m = NewManager(Config{Addr: first.addr, User: "me", Home: home, DataDir: data})
	if err := m.Check(); err != nil {
		t.Fatal(err)
	}
	// Same address, different host key.
	second := startFakeSSH(t, allow)
	m.cfg.Addr = second.addr
	if err := m.Check(); err == nil || !strings.Contains(err.Error(), "host key") {
		t.Errorf("want a host key error, got %v", err)
	}
}
