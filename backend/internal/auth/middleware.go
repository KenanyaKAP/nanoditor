// Package auth gates every request on the caller's Tailscale identity.
package auth

import (
	"context"
	"log"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"nanoditor/internal/apperr"
)

type ctxKey struct{}

// FromContext returns the identity attached by the middleware.
func FromContext(ctx context.Context) *Identity {
	id, _ := ctx.Value(ctxKey{}).(*Identity)
	return id
}

type cached struct {
	id      *Identity
	ok      bool
	expires time.Time
}

type Middleware struct {
	whois         WhoIser
	allowed       []string
	trustLoopback bool
	ttl           time.Duration
	onDeny        func(w http.ResponseWriter, err *apperr.Error)

	mu    sync.Mutex
	cache map[string]cached
}

func NewMiddleware(w WhoIser, allowedLogins []string, trustLoopback bool, onDeny func(http.ResponseWriter, *apperr.Error)) *Middleware {
	lower := make([]string, len(allowedLogins))
	for i, l := range allowedLogins {
		lower[i] = strings.ToLower(l)
	}
	return &Middleware{
		whois:         w,
		allowed:       lower,
		trustLoopback: trustLoopback,
		ttl:           5 * time.Minute,
		onDeny:        onDeny,
		cache:         map[string]cached{},
	}
}

func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := m.identify(r)
		if err != nil {
			m.onDeny(w, err)
			return
		}
		if !safeMethod(r.Method) && r.Header.Get("X-ND") != "1" {
			m.onDeny(w, apperr.Forbidden("missing X-ND header"))
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	})
}

func (m *Middleware) identify(r *http.Request) (*Identity, *apperr.Error) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return nil, apperr.Forbidden("bad remote address")
	}
	ip := net.ParseIP(host)
	if m.trustLoopback && ip != nil && ip.IsLoopback() {
		return &Identity{Login: "local", Node: "localhost"}, nil
	}

	m.mu.Lock()
	c, hit := m.cache[host]
	m.mu.Unlock()
	if hit && time.Now().Before(c.expires) {
		if !c.ok {
			return nil, apperr.Forbidden("not an allowed tailnet user")
		}
		return c.id, nil
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	id, werr := m.whois.WhoIs(ctx, r.RemoteAddr)
	ok := werr == nil && id != nil && slices.Contains(m.allowed, strings.ToLower(id.Login))

	// Cache denials too, but only briefly, so a tailscaled hiccup heals fast.
	ttl := m.ttl
	if !ok {
		ttl = 15 * time.Second
	}
	m.mu.Lock()
	m.cache[host] = cached{id: id, ok: ok, expires: time.Now().Add(ttl)}
	m.mu.Unlock()

	if !ok {
		login := ""
		if id != nil {
			login = id.Login
		}
		log.Printf("auth: denied %s %s (login=%q whois_err=%v)", r.RemoteAddr, r.URL.Path, login, werr)
		return nil, apperr.Forbidden("not an allowed tailnet user")
	}
	return id, nil
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}
