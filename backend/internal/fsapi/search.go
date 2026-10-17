package fsapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"nanoditor/internal/apperr"
)

// SkipDirs are never descended into by searches and repo discovery.
var SkipDirs = map[string]bool{
	".git": true, "node_modules": true, "vendor": true, "dist": true, "build": true,
	".venv": true, "venv": true, "__pycache__": true, "target": true, ".next": true,
	".cache": true, ".idea": true, ".gradle": true, ".dart_tool": true, "Pods": true,
	".trash": true, ".Trash": true,
}

type SearchHit struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Type string `json:"type"`
	Line int    `json:"line,omitempty"`
	Text string `json:"text,omitempty"`
}

type SearchResult struct {
	Hits      []SearchHit `json:"hits"`
	Truncated bool        `json:"truncated"`
}

func (s *Service) Search(ctx context.Context, root, q, mode string, limit int) (*SearchResult, error) {
	dir, err := s.Box.Resolve(root)
	if err != nil {
		return nil, err
	}
	q = strings.TrimSpace(q)
	if q == "" {
		return &SearchResult{Hits: []SearchHit{}}, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if mode == "content" {
		return contentSearch(ctx, dir, q, limit)
	}
	return nameSearch(ctx, dir, q, limit)
}

var errStop = errors.New("stop")

func nameSearch(ctx context.Context, root, q string, limit int) (*SearchResult, error) {
	res := &SearchResult{Hits: []SearchHit{}}
	needle := strings.ToLower(q)
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if ctx.Err() != nil {
			res.Truncated = true
			return errStop
		}
		name := d.Name()
		if d.IsDir() && p != root && (SkipDirs[name] || strings.HasPrefix(name, ".")) {
			return fs.SkipDir
		}
		if p == root {
			return nil
		}
		if strings.Contains(strings.ToLower(name), needle) {
			t := "file"
			if d.IsDir() {
				t = "dir"
			}
			res.Hits = append(res.Hits, SearchHit{Path: p, Name: name, Type: t})
			if len(res.Hits) >= limit {
				res.Truncated = true
				return errStop
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, errStop) {
		return nil, err
	}
	return res, nil
}

type rgMsg struct {
	Type string `json:"type"`
	Data struct {
		Path struct {
			Text string `json:"text"`
		} `json:"path"`
		Lines struct {
			Text string `json:"text"`
		} `json:"lines"`
		LineNumber int `json:"line_number"`
	} `json:"data"`
}

func contentSearch(ctx context.Context, root, q string, limit int) (*SearchResult, error) {
	if _, err := exec.LookPath("rg"); err != nil {
		return nil, apperr.New(501, "no_ripgrep", "content search needs ripgrep (rg)")
	}
	args := []string{"--json", "--smart-case", "--fixed-strings", "--max-count", "5",
		"--max-filesize", "1M", "--max-columns", "300"}
	for d := range SkipDirs {
		args = append(args, "--glob", "!"+d)
	}
	args = append(args, "--", q, root)
	cmd := exec.CommandContext(ctx, "rg", args...)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	res := &SearchResult{Hits: []SearchHit{}}
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for sc.Scan() {
		var m rgMsg
		if json.Unmarshal(sc.Bytes(), &m) != nil || m.Type != "match" {
			continue
		}
		p := m.Data.Path.Text
		res.Hits = append(res.Hits, SearchHit{
			Path: p, Name: filepath.Base(p), Type: "file",
			Line: m.Data.LineNumber, Text: strings.TrimRight(m.Data.Lines.Text, "\r\n"),
		})
		if len(res.Hits) >= limit {
			res.Truncated = true
			break
		}
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	if ctx.Err() != nil {
		res.Truncated = true
	}
	return res, nil
}
