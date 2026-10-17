package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"nanoditor/internal/apperr"
)

type fakeWhoIs struct {
	byIP  map[string]string
	calls int
}

func (f *fakeWhoIs) WhoIs(_ context.Context, addr string) (*Identity, error) {
	f.calls++
	host := addr[:len(addr)-len(":1234")]
	if login, ok := f.byIP[host]; ok {
		return &Identity{Login: login}, nil
	}
	return nil, errors.New("no such peer")
}

func run(m *Middleware, method, remote string, hdr bool) int {
	h := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if FromContext(r.Context()) == nil {
			w.WriteHeader(500)
		}
	}))
	req := httptest.NewRequest(method, "/api/x", nil)
	req.RemoteAddr = remote
	if hdr {
		req.Header.Set("X-ND", "1")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func deny(w http.ResponseWriter, e *apperr.Error) { w.WriteHeader(e.Status) }

func TestMiddleware(t *testing.T) {
	f := &fakeWhoIs{byIP: map[string]string{"100.64.1.5": "Me@Example.com", "100.64.1.9": "someone@else.com"}}
	m := NewMiddleware(f, []string{"me@example.com"}, false, deny)

	if c := run(m, "GET", "100.64.1.5:1234", false); c != 200 {
		t.Errorf("allowed user: %d", c)
	}
	if c := run(m, "GET", "100.64.1.9:1234", false); c != 403 {
		t.Errorf("other tailnet user: %d", c)
	}
	if c := run(m, "GET", "192.168.1.20:1234", false); c != 403 {
		t.Errorf("LAN address: %d", c)
	}
	if c := run(m, "GET", "127.0.0.1:1234", false); c != 403 {
		t.Errorf("loopback without dev flag: %d", c)
	}
	if c := run(m, "POST", "100.64.1.5:1234", false); c != 403 {
		t.Errorf("POST without X-ND: %d", c)
	}
	if c := run(m, "POST", "100.64.1.5:1234", true); c != 200 {
		t.Errorf("POST with X-ND: %d", c)
	}

	before := f.calls
	run(m, "GET", "100.64.1.5:1234", false)
	if f.calls != before {
		t.Error("expected a cache hit")
	}

	dev := NewMiddleware(f, nil, true, deny)
	if c := run(dev, "GET", "127.0.0.1:1234", false); c != 200 {
		t.Errorf("loopback with dev flag: %d", c)
	}
}
