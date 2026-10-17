package fsapi

import (
	"mime"
	"net/http"
	"path/filepath"
	"strings"
)

var extraTypes = map[string]string{
	".md":       "text/markdown",
	".markdown": "text/markdown",
	".go":       "text/x-go",
	".ts":       "text/typescript",
	".tsx":      "text/typescript",
	".jsx":      "text/javascript",
	".py":       "text/x-python",
	".rs":       "text/x-rust",
	".yaml":     "text/yaml",
	".yml":      "text/yaml",
	".toml":     "text/x-toml",
	".sh":       "text/x-shellscript",
	".env":      "text/plain",
	".heic":     "image/heic",
	".webp":     "image/webp",
	".svg":      "image/svg+xml",
}

// MimeType guesses a content type from the extension, then the content.
func MimeType(path string, head []byte) string {
	ext := strings.ToLower(filepath.Ext(path))
	if t, ok := extraTypes[ext]; ok {
		return t
	}
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return http.DetectContentType(head)
}
