package game

import "testing"

func TestResolveNight(t *testing.T) {
	roles := map[string]Role{
		"Alice": RoleMurderer,
		"Bob":   RoleDoctor,
		"Carol": RoleInvestigator,
		"Dave":  RoleCivilian,
		"Eve":   RoleCivilian,
	}
	alive := map[string]bool{
		"Alice": true, "Bob": true, "Carol": true, "Dave": true, "Eve": true,
	}

	tests := []struct {
		name    string
		actions NightActions
		want    NightResult
	}{
		{
			name:    "kill lands — no save",
			actions: NightActions{Kill: "Dave"},
			want:    NightResult{Victim: "Dave"},
		},
		{
			name:    "kill blocked by doctor",
			actions: NightActions{Kill: "Dave", Save: "Dave"},
			want:    NightResult{Saved: true},
		},
		{
			name:    "doctor saves different player — kill lands",
			actions: NightActions{Kill: "Dave", Save: "Eve"},
			want:    NightResult{Victim: "Dave"},
		},
		{
			name:    "no actions submitted",
			actions: NightActions{},
			want:    NightResult{},
		},
		{
			name:    "inspect a civilian",
			actions: NightActions{Inspect: "Eve"},
			want:    NightResult{Inspected: "Eve", InspectedRole: RoleCivilian},
		},
		{
			name:    "inspect the murderer",
			actions: NightActions{Inspect: "Alice"},
			want:    NightResult{Inspected: "Alice", InspectedRole: RoleMurderer},
		},
		{
			name:    "kill and inspect simultaneously",
			actions: NightActions{Kill: "Dave", Inspect: "Alice"},
			want:    NightResult{Victim: "Dave", Inspected: "Alice", InspectedRole: RoleMurderer},
		},
		{
			name:    "save blocks kill, inspect still happens",
			actions: NightActions{Kill: "Dave", Save: "Dave", Inspect: "Eve"},
			want:    NightResult{Saved: true, Inspected: "Eve", InspectedRole: RoleCivilian},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveNight(tt.actions, roles, alive)
			if got != tt.want {
				t.Errorf("ResolveNight() = %+v; want %+v", got, tt.want)
			}
		})
	}
}
