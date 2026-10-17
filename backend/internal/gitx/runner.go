// Package gitx drives the git CLI for status, diffs, staging and history.
package gitx

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"nanoditor/internal/apperr"
)

type Runner struct {
	locks sync.Map // repo path -> *sync.Mutex
}

type Result struct {
	Stdout   []byte
	Stderr   string
	ExitCode int
}

type runOpts struct {
	stdin   []byte
	timeout time.Duration
	// okCodes lists non-zero exit codes that are not errors (e.g. diff --no-index exits 1).
	okCodes []int
	write   bool
}

func (r *Runner) lock(repo string) func() {
	m, _ := r.locks.LoadOrStore(repo, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

func (r *Runner) run(ctx context.Context, repo string, o runOpts, args ...string) (*Result, error) {
	if o.write {
		defer r.lock(repo)()
	}
	if o.timeout == 0 {
		o.timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, o.timeout)
	defer cancel()

	full := append([]string{"-C", repo, "-c", "core.quotepath=off", "-c", "color.ui=false"}, args...)
	cmd := exec.CommandContext(ctx, "git", full...)
	env := append(os.Environ(),
		"LC_ALL=C",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_SSH_COMMAND=ssh -o BatchMode=yes -o ConnectTimeout=15",
		"GIT_EDITOR=true",
		"GIT_PAGER=cat",
	)
	if !o.write {
		// Read-only commands must not take index.lock (an editor like VS Code may hold it).
		env = append(env, "GIT_OPTIONAL_LOCKS=0")
	}
	cmd.Env = env
	if o.stdin != nil {
		cmd.Stdin = bytes.NewReader(o.stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	res := &Result{Stdout: stdout.Bytes(), Stderr: strings.TrimSpace(stderr.String())}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			res.ExitCode = ee.ExitCode()
			for _, c := range o.okCodes {
				if c == res.ExitCode {
					return res, nil
				}
			}
		}
		if ctx.Err() == context.DeadlineExceeded {
			return res, apperr.New(http.StatusGatewayTimeout, "git_timeout", "git took too long").WithDetail(strings.Join(args, " "))
		}
		return res, gitError(args, res)
	}
	return res, nil
}

func gitError(args []string, res *Result) error {
	msg := res.Stderr
	if msg == "" {
		msg = strings.TrimSpace(string(res.Stdout))
	}
	switch {
	case strings.Contains(msg, "index.lock"):
		return apperr.Conflict("git_locked", "Another git process is using this repo (VS Code?). Try again in a moment.").WithDetail(msg)
	case strings.Contains(msg, "not a git repository"):
		return apperr.BadRequest("not a git repository").WithDetail(msg)
	case strings.Contains(msg, "Permission denied (publickey") || strings.Contains(msg, "Host key verification failed"):
		return apperr.New(http.StatusBadGateway, "git_auth", "SSH authentication to the remote failed").WithDetail(msg)
	case strings.Contains(msg, "could not read Username") || strings.Contains(msg, "terminal prompts disabled"):
		return apperr.New(http.StatusBadGateway, "git_auth", "The remote needs credentials (HTTPS remote without a stored credential)").WithDetail(msg)
	}
	first := msg
	if i := strings.IndexByte(first, '\n'); i > 0 {
		first = first[:i]
	}
	if first == "" {
		first = "git " + args[0] + " failed"
	}
	return apperr.New(http.StatusUnprocessableEntity, "git_failed", first).WithDetail(msg)
}
