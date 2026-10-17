package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Identity is who is on the other end of a request, as reported by tailscaled.
type Identity struct {
	Login       string `json:"login"`
	DisplayName string `json:"displayName"`
	Node        string `json:"node"`
	OS          string `json:"os"`
}

type WhoIser interface {
	WhoIs(ctx context.Context, addr string) (*Identity, error)
}

// LocalAPI talks to tailscaled over its unix socket.
type LocalAPI struct {
	client *http.Client
}

func NewLocalAPI(socket string) *LocalAPI {
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", socket)
		},
	}
	return &LocalAPI{client: &http.Client{Transport: tr, Timeout: 3 * time.Second}}
}

type whoisResp struct {
	Node struct {
		Name         string `json:"Name"`
		ComputedName string `json:"ComputedName"`
		Hostinfo     struct {
			OS string `json:"OS"`
		} `json:"Hostinfo"`
	} `json:"Node"`
	UserProfile struct {
		LoginName   string `json:"LoginName"`
		DisplayName string `json:"DisplayName"`
	} `json:"UserProfile"`
}

func (l *LocalAPI) WhoIs(ctx context.Context, addr string) (*Identity, error) {
	u := "http://local-tailscaled.sock/localapi/v0/whois?addr=" + url.QueryEscape(addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("whois %s: status %d", addr, resp.StatusCode)
	}
	var w whoisResp
	if err := json.NewDecoder(resp.Body).Decode(&w); err != nil {
		return nil, err
	}
	node := w.Node.ComputedName
	if node == "" {
		node = strings.SplitN(w.Node.Name, ".", 2)[0]
	}
	return &Identity{
		Login:       w.UserProfile.LoginName,
		DisplayName: w.UserProfile.DisplayName,
		Node:        node,
		OS:          w.Node.Hostinfo.OS,
	}, nil
}
