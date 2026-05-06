package game

import "testing"

func TestCheckWin(t *testing.T) {
	tests := []struct {
		name  string
		roles map[string]Role
		alive map[string]bool
		want  Winner
	}{
		{
			name: "game ongoing — murderer + 3 civilians alive",
			roles: map[string]Role{
				"Alice": RoleMurderer, "Bob": RoleDoctor,
				"Carol": RoleInvestigator, "Dave": RoleCivilian, "Eve": RoleCivilian,
			},
			alive: map[string]bool{
				"Alice": true, "Bob": true, "Carol": true, "Dave": true, "Eve": true,
			},
			want: WinnerNone,
		},
		{
			name: "civilians win — murderer is dead",
			roles: map[string]Role{
				"Alice": RoleMurderer, "Bob": RoleDoctor,
				"Carol": RoleInvestigator, "Dave": RoleCivilian, "Eve": RoleCivilian,
			},
			alive: map[string]bool{
				"Alice": false, "Bob": true, "Carol": true, "Dave": true, "Eve": true,
			},
			want: WinnerCivilians,
		},
		{
			name: "murderer wins — civilians <= 1",
			roles: map[string]Role{
				"Alice": RoleMurderer, "Bob": RoleDoctor,
				"Carol": RoleCivilian,
			},
			alive: map[string]bool{
				"Alice": true, "Bob": false, "Carol": true,
			},
			want: WinnerMurderer,
		},
		{
			name: "murderer wins — exactly 1 civilian alive",
			roles: map[string]Role{
				"Alice": RoleMurderer, "Bob": RoleCivilian,
			},
			alive: map[string]bool{"Alice": true, "Bob": true},
			want:  WinnerMurderer,
		},
		{
			name: "murderer wins — no civilians alive",
			roles: map[string]Role{
				"Alice": RoleMurderer, "Bob": RoleCivilian, "Carol": RoleCivilian,
			},
			alive: map[string]bool{"Alice": true, "Bob": false, "Carol": false},
			want:  WinnerMurderer,
		},
		{
			name: "game ongoing — murderer + exactly 2 non-murderers alive",
			roles: map[string]Role{
				"Alice": RoleMurderer, "Bob": RoleDoctor, "Carol": RoleCivilian,
			},
			alive: map[string]bool{"Alice": true, "Bob": true, "Carol": true},
			want:  WinnerNone,
		},
		{
			name: "civilians win — all dead except non-murderers",
			roles: map[string]Role{
				"Alice": RoleMurderer, "Bob": RoleCivilian, "Carol": RoleCivilian,
			},
			alive: map[string]bool{"Alice": false, "Bob": true, "Carol": false},
			want:  WinnerCivilians,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CheckWin(tt.roles, tt.alive)
			if got != tt.want {
				t.Errorf("CheckWin() = %q; want %q", got, tt.want)
			}
		})
	}
}
