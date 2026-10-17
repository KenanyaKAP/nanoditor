package gitx

import (
	"crypto/sha1"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
)

type Line struct {
	Type  string `json:"t"` // "+", "-", " ", or "\\" for "no newline" markers
	Text  string `json:"s"`
	OldNo int    `json:"o,omitempty"`
	NewNo int    `json:"n,omitempty"`
}

type Hunk struct {
	ID       string `json:"id"`
	Header   string `json:"header"`
	OldStart int    `json:"oldStart"`
	OldLines int    `json:"oldLines"`
	NewStart int    `json:"newStart"`
	NewLines int    `json:"newLines"`
	Lines    []Line `json:"lines"`
	raw      []string
}

type FileDiff struct {
	Path     string  `json:"path"`
	OldPath  string  `json:"oldPath,omitempty"`
	Status   string  `json:"status"` // modified | added | deleted | renamed
	Binary   bool    `json:"binary"`
	Hunks    []*Hunk `json:"hunks"`
	Added    int     `json:"added"`
	Removed  int     `json:"removed"`
	TooLarge bool    `json:"tooLarge,omitempty"`
	header   []string
}

var hunkRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

// ParseDiff parses unified diff output (possibly several files).
func ParseDiff(out string) []*FileDiff {
	var files []*FileDiff
	var cur *FileDiff
	var h *Hunk
	oldNo, newNo := 0, 0

	lines := strings.Split(out, "\n")
	if n := len(lines); n > 0 && lines[n-1] == "" {
		lines = lines[:n-1]
	}
	finishHunk := func() {
		if h != nil && cur != nil {
			h.ID = hunkID(h)
			cur.Hunks = append(cur.Hunks, h)
		}
		h = nil
	}
	for _, l := range lines {
		if strings.HasPrefix(l, "diff --git ") || strings.HasPrefix(l, "diff --cc ") {
			finishHunk()
			cur = &FileDiff{Status: "modified", Hunks: []*Hunk{}}
			files = append(files, cur)
			cur.header = append(cur.header, l)
			cur.Path, cur.OldPath = pathsFromDiffLine(l)
			continue
		}
		if cur == nil {
			continue
		}
		if h == nil {
			if m := hunkRe.FindStringSubmatch(l); m != nil {
				h = &Hunk{Header: l, Lines: []Line{}}
				h.OldStart, h.OldLines = atoi(m[1]), atoiDef(m[2], 1)
				h.NewStart, h.NewLines = atoi(m[3]), atoiDef(m[4], 1)
				oldNo, newNo = h.OldStart, h.NewStart
				continue
			}
			cur.header = append(cur.header, l)
			parseHeaderLine(cur, l)
			continue
		}
		if m := hunkRe.FindStringSubmatch(l); m != nil {
			finishHunk()
			h = &Hunk{Header: l, Lines: []Line{}}
			h.OldStart, h.OldLines = atoi(m[1]), atoiDef(m[2], 1)
			h.NewStart, h.NewLines = atoi(m[3]), atoiDef(m[4], 1)
			oldNo, newNo = h.OldStart, h.NewStart
			continue
		}
		if l == "" {
			// A blank context line can lose its leading space in some outputs.
			l = " "
		}
		h.raw = append(h.raw, l)
		switch l[0] {
		case '+':
			h.Lines = append(h.Lines, Line{Type: "+", Text: l[1:], NewNo: newNo})
			newNo++
			cur.Added++
		case '-':
			h.Lines = append(h.Lines, Line{Type: "-", Text: l[1:], OldNo: oldNo})
			oldNo++
			cur.Removed++
		case '\\':
			h.Lines = append(h.Lines, Line{Type: "\\", Text: strings.TrimPrefix(l, "\\ ")})
		default:
			h.Lines = append(h.Lines, Line{Type: " ", Text: l[1:], OldNo: oldNo, NewNo: newNo})
			oldNo++
			newNo++
		}
	}
	finishHunk()
	return files
}

func parseHeaderLine(f *FileDiff, l string) {
	switch {
	case strings.HasPrefix(l, "new file mode"):
		f.Status = "added"
	case strings.HasPrefix(l, "deleted file mode"):
		f.Status = "deleted"
	case strings.HasPrefix(l, "rename from "):
		f.Status = "renamed"
		f.OldPath = strings.TrimPrefix(l, "rename from ")
	case strings.HasPrefix(l, "rename to "):
		f.Path = strings.TrimPrefix(l, "rename to ")
	case strings.HasPrefix(l, "Binary files ") || l == "GIT binary patch":
		f.Binary = true
	case strings.HasPrefix(l, "+++ ") && l != "+++ /dev/null":
		f.Path = strings.TrimPrefix(unquote(strings.TrimPrefix(l, "+++ ")), "b/")
	case strings.HasPrefix(l, "--- ") && l != "--- /dev/null":
		if f.OldPath == "" {
			old := strings.TrimPrefix(unquote(strings.TrimPrefix(l, "--- ")), "a/")
			if old != f.Path {
				f.OldPath = old
			}
		}
	}
}

// pathsFromDiffLine extracts paths from "diff --git a/x b/y" (best effort;
// the ---/+++ and rename lines refine it).
func pathsFromDiffLine(l string) (string, string) {
	rest := strings.TrimPrefix(strings.TrimPrefix(l, "diff --git "), "diff --cc ")
	if strings.HasPrefix(rest, "a/") {
		if i := strings.Index(rest, " b/"); i >= 0 {
			return rest[i+3:], ""
		}
	}
	return rest, ""
}

func unquote(s string) string {
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		if u, err := strconv.Unquote(s); err == nil {
			return u
		}
	}
	return s
}

func hunkID(h *Hunk) string {
	sum := sha1.Sum([]byte(h.Header + "\n" + strings.Join(h.raw, "\n")))
	return hex.EncodeToString(sum[:6])
}

// Patch renders a minimal patch containing only the given hunk.
func (f *FileDiff) Patch(h *Hunk) []byte {
	var b strings.Builder
	for _, l := range f.header {
		b.WriteString(l)
		b.WriteByte('\n')
	}
	b.WriteString(h.Header)
	b.WriteByte('\n')
	for _, l := range h.raw {
		b.WriteString(l)
		b.WriteByte('\n')
	}
	return []byte(b.String())
}

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

func atoiDef(s string, def int) int {
	if s == "" {
		return def
	}
	return atoi(s)
}
