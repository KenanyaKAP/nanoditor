package gitx

import (
	"strconv"
	"strings"
)

type Branch struct {
	Head     string `json:"head"`     // branch name, or "" when detached
	Oid      string `json:"oid"`      // "" before the first commit
	Upstream string `json:"upstream"` // "" if none
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	Detached bool   `json:"detached"`
}

type FileStatus struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath,omitempty"`
	X        string `json:"x"` // index status, "." for unmodified
	Y        string `json:"y"` // worktree status
	Kind     string `json:"kind"`
}

type Status struct {
	Branch    Branch       `json:"branch"`
	Staged    []FileStatus `json:"staged"`
	Changes   []FileStatus `json:"changes"`
	Untracked []FileStatus `json:"untracked"`
	Conflicts []FileStatus `json:"conflicts"`
}

// ParseStatus parses `git status --porcelain=v2 -z --branch`.
func ParseStatus(out []byte) *Status {
	st := &Status{Staged: []FileStatus{}, Changes: []FileStatus{}, Untracked: []FileStatus{}, Conflicts: []FileStatus{}}
	recs := strings.Split(string(out), "\x00")
	for i := 0; i < len(recs); i++ {
		rec := recs[i]
		if rec == "" {
			continue
		}
		switch rec[0] {
		case '#':
			parseBranchHeader(&st.Branch, rec)
		case '1':
			f := strings.SplitN(rec, " ", 9)
			if len(f) < 9 {
				continue
			}
			addEntry(st, FileStatus{Path: f[8], X: f[1][:1], Y: f[1][1:], Kind: "ordinary"})
		case '2':
			f := strings.SplitN(rec, " ", 10)
			if len(f) < 10 {
				continue
			}
			fs := FileStatus{Path: f[9], X: f[1][:1], Y: f[1][1:], Kind: "rename"}
			if i+1 < len(recs) {
				i++
				fs.OrigPath = recs[i]
			}
			addEntry(st, fs)
		case 'u':
			f := strings.SplitN(rec, " ", 11)
			if len(f) < 11 {
				continue
			}
			st.Conflicts = append(st.Conflicts, FileStatus{Path: f[10], X: f[1][:1], Y: f[1][1:], Kind: "unmerged"})
		case '?':
			st.Untracked = append(st.Untracked, FileStatus{Path: rec[2:], X: "?", Y: "?", Kind: "untracked"})
		}
	}
	return st
}

func addEntry(st *Status, fs FileStatus) {
	if fs.X != "." {
		st.Staged = append(st.Staged, fs)
	}
	if fs.Y != "." {
		st.Changes = append(st.Changes, fs)
	}
}

func parseBranchHeader(b *Branch, rec string) {
	parts := strings.SplitN(rec, " ", 3)
	if len(parts) < 3 {
		return
	}
	val := parts[2]
	switch parts[1] {
	case "branch.oid":
		if val != "(initial)" {
			b.Oid = val
		}
	case "branch.head":
		if val == "(detached)" {
			b.Detached = true
		} else {
			b.Head = val
		}
	case "branch.upstream":
		b.Upstream = val
	case "branch.ab":
		for _, f := range strings.Fields(val) {
			n, _ := strconv.Atoi(f[1:])
			if f[0] == '+' {
				b.Ahead = n
			} else if f[0] == '-' {
				b.Behind = n
			}
		}
	}
}
