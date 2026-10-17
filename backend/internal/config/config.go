// Package config loads runtime settings from environment variables.
package config

import (
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	ListenAddr      string
	DataDir         string
	Home            string
	AllowedRoots    []string
	AllowedLogins   []string
	DevTrustLocal   bool
	TailscaleSocket string
	Version         string
}

func Load() Config {
	home := env("HOME", "/home/ken")
	c := Config{
		ListenAddr:      env("LISTEN_ADDR", ":7777"),
		DataDir:         env("DATA_DIR", filepath.Join(home, ".local/share/kennycode")),
		Home:            home,
		AllowedRoots:    list(env("ALLOWED_ROOTS", home)),
		AllowedLogins:   list(env("ALLOWED_LOGINS", "")),
		DevTrustLocal:   env("DEV_TRUST_LOCAL", "false") == "true",
		TailscaleSocket: env("TAILSCALE_SOCKET", "/var/run/tailscale/tailscaled.sock"),
		Version:         env("APP_VERSION", "dev"),
	}
	return c
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func list(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
