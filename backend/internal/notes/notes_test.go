package notes

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestDetectVaults(t *testing.T) {
	root := t.TempDir()
	for _, d := range []string{
		"ProjectA/docs/.obsidian",
		"ProjectB/.obsidian",
		"ProjectB/inner/.obsidian", // inside a vault: not reported separately
		"ProjectC/node_modules/x/.obsidian",
		"deep/1/2/3/.obsidian",
	} {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	got := DetectVaults(root, 3)
	want := []string{filepath.Join(root, "ProjectA/docs"), filepath.Join(root, "ProjectB")}
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Errorf("DetectVaults = %v, want %v", got, want)
	}
}
