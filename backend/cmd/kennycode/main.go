// Command kennycode serves the KennyCode mobile companion app.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"kennycode/internal/auth"
	"kennycode/internal/config"
	"kennycode/internal/fsapi"
	"kennycode/internal/gitx"
	"kennycode/internal/httpapi"
	"kennycode/internal/notes"
	"kennycode/internal/pathsafe"
	"kennycode/internal/store"
	"kennycode/web"
)

func main() {
	cfg := config.Load()
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(cfg.ListenAddr))
	}
	if len(cfg.AllowedLogins) == 0 && !cfg.DevTrustLocal {
		log.Fatal("ALLOWED_LOGINS is empty: nobody could use the app. Set it in .env")
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatalf("data dir: %v", err)
	}
	st, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	box, err := pathsafe.New(cfg.AllowedRoots, cfg.Home)
	if err != nil {
		log.Fatalf("sandbox: %v", err)
	}
	fsSvc := &fsapi.Service{Box: box, TrashDir: filepath.Join(cfg.DataDir, "trash")}
	srv := &httpapi.Server{
		Cfg:   cfg,
		Store: st,
		Box:   box,
		FS:    fsSvc,
		Notes: &notes.Service{FS: fsSvc},
		Git:   &gitx.Service{R: &gitx.Runner{}},
		Auth:  auth.NewMiddleware(auth.NewLocalAPI(cfg.TailscaleSocket), cfg.AllowedLogins, cfg.DevTrustLocal, httpapi.WriteDenied),
		Web:   web.FS(),
	}
	if srv.Web == nil {
		log.Print("warning: frontend not embedded; only the API is served")
	}

	hs := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("kennycode %s listening on %s (roots %v)", cfg.Version, cfg.ListenAddr, box.Roots())
		if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = hs.Shutdown(ctx)
}

func healthcheck(addr string) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		port = "7777"
	}
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%s/api/healthz", port))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
