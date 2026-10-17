// Package apperr defines errors that carry an HTTP status and a stable code.
package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
	// Extra is merged into the error payload (e.g. current etag on conflict).
	Extra map[string]any `json:"extra,omitempty"`
}

func (e *Error) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("%s: %s (%s)", e.Code, e.Message, e.Detail)
	}
	return e.Code + ": " + e.Message
}

func New(status int, code, msg string) *Error {
	return &Error{Status: status, Code: code, Message: msg}
}

func (e *Error) WithDetail(d string) *Error {
	e.Detail = d
	return e
}

func (e *Error) With(k string, v any) *Error {
	if e.Extra == nil {
		e.Extra = map[string]any{}
	}
	e.Extra[k] = v
	return e
}

func BadRequest(msg string) *Error { return New(http.StatusBadRequest, "bad_request", msg) }
func NotFound(msg string) *Error   { return New(http.StatusNotFound, "not_found", msg) }
func Forbidden(msg string) *Error  { return New(http.StatusForbidden, "forbidden", msg) }
func Conflict(code, msg string) *Error {
	return New(http.StatusConflict, code, msg)
}

// From converts any error into an *Error, defaulting to 500.
func From(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return New(http.StatusInternalServerError, "internal", err.Error())
}
