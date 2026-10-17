package store

import "testing"

func TestWorkspaceSettingsAreIndependent(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	a, _ := s.UpsertWorkspace("A", "/w/a")
	b, _ := s.UpsertWorkspace("B", "/w/b")
	if a.Settings != DefaultWorkspaceSettings() {
		t.Fatalf("new workspace settings = %+v, want defaults", a.Settings)
	}

	set := WorkspaceSettings{VaultPath: "/w/a/notes", DailyFolder: "Journal", InboxFile: "In.md", ScanDepth: 5, ShowHidden: true}
	if err := s.UpdateWorkspace(a.ID, nil, &set, false); err != nil {
		t.Fatal(err)
	}
	gotA, _ := s.Workspace(a.ID)
	gotB, _ := s.Workspace(b.ID)
	if gotA.Settings != set {
		t.Errorf("A = %+v, want %+v", gotA.Settings, set)
	}
	if gotB.Settings != DefaultWorkspaceSettings() {
		t.Errorf("B changed too: %+v", gotB.Settings)
	}

	// Re-opening a workspace keeps its settings.
	again, _ := s.UpsertWorkspace("A", "/w/a")
	if again.Settings != set {
		t.Errorf("upsert reset settings: %+v", again.Settings)
	}
}
