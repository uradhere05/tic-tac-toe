package game

import "testing"

func TestResolveVote(t *testing.T) {
	roles := map[string]Role{
		"Alice": RoleMurderer,
		"Bob":   RoleDoctor,
		"Carol": RoleInvestigator,
		"Dave":  RoleCivilian,
		"Eve":   RoleCivilian,
	}

	tests := []struct {
		name     string
		votes    map[string]string
		wantElim string
		wantTied bool
		wantAnn  string
	}{
		{
			name:     "clear majority eliminates murderer",
			votes:    map[string]string{"Bob": "Alice", "Carol": "Alice", "Dave": "Alice"},
			wantElim: "Alice",
			wantAnn:  "Alice was eliminated. They were THE MURDERER! 🔪",
		},
		{
			name:     "clear majority eliminates civilian",
			votes:    map[string]string{"Bob": "Dave", "Carol": "Dave", "Alice": "Eve"},
			wantElim: "Dave",
			wantAnn:  "Dave was eliminated. They were a civilian.",
		},
		{
			name:     "tied vote — no elimination",
			votes:    map[string]string{"Bob": "Alice", "Carol": "Dave"},
			wantTied: true,
			wantAnn:  "Tied vote — no one eliminated.",
		},
		{
			name:    "all defer — no elimination",
			votes:   map[string]string{"Bob": "defer", "Carol": "defer", "Dave": "defer"},
			wantAnn: "No votes cast — no elimination.",
		},
		{
			name:     "mix of real votes and defers — majority wins",
			votes:    map[string]string{"Bob": "Alice", "Carol": "Alice", "Dave": "defer"},
			wantElim: "Alice",
			wantAnn:  "Alice was eliminated. They were THE MURDERER! 🔪",
		},
		{
			name:    "empty votes map",
			votes:   map[string]string{},
			wantAnn: "No votes cast — no elimination.",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveVote(tt.votes, roles)
			if got.Eliminated != tt.wantElim {
				t.Errorf("Eliminated = %q; want %q", got.Eliminated, tt.wantElim)
			}
			if got.Tied != tt.wantTied {
				t.Errorf("Tied = %v; want %v", got.Tied, tt.wantTied)
			}
			if got.Announcement != tt.wantAnn {
				t.Errorf("Announcement = %q; want %q", got.Announcement, tt.wantAnn)
			}
		})
	}
}
