package game

import "testing"

func TestValidateRoles(t *testing.T) {
	valid := map[string]Role{
		"Alice": RoleMurderer,
		"Bob":   RoleDoctor,
		"Carol": RoleInvestigator,
		"Dave":  RoleCivilian,
		"Eve":   RoleCivilian,
	}

	tests := []struct {
		name    string
		roles   map[string]Role
		wantErr bool
	}{
		{"valid 5-player game", valid, false},
		{"valid 6-player game", func() map[string]Role {
			m := copyRoles(valid)
			m["Frank"] = RoleCivilian
			return m
		}(), false},
		{"too few players", map[string]Role{
			"Alice": RoleMurderer, "Bob": RoleDoctor,
			"Carol": RoleInvestigator, "Dave": RoleCivilian,
		}, true},
		{"missing murderer", map[string]Role{
			"Alice": RoleCivilian, "Bob": RoleDoctor,
			"Carol": RoleInvestigator, "Dave": RoleCivilian, "Eve": RoleCivilian,
		}, true},
		{"two murderers", map[string]Role{
			"Alice": RoleMurderer, "Bob": RoleMurderer,
			"Carol": RoleInvestigator, "Dave": RoleCivilian, "Eve": RoleDoctor,
		}, true},
		{"missing doctor", map[string]Role{
			"Alice": RoleMurderer, "Bob": RoleCivilian,
			"Carol": RoleInvestigator, "Dave": RoleCivilian, "Eve": RoleCivilian,
		}, true},
		{"missing investigator", map[string]Role{
			"Alice": RoleMurderer, "Bob": RoleDoctor,
			"Carol": RoleCivilian, "Dave": RoleCivilian, "Eve": RoleCivilian,
		}, true},
		{"empty role", map[string]Role{
			"Alice": RoleMurderer, "Bob": RoleDoctor,
			"Carol": RoleInvestigator, "Dave": RoleCivilian, "Eve": "",
		}, true},
		{"unknown role", map[string]Role{
			"Alice": RoleMurderer, "Bob": RoleDoctor,
			"Carol": RoleInvestigator, "Dave": RoleCivilian, "Eve": Role("werewolf"),
		}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRoles(tt.roles)
			if tt.wantErr && err == nil {
				t.Errorf("ValidateRoles() = nil; want error")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("ValidateRoles() = %v; want nil", err)
			}
		})
	}
}

func TestAliveCount(t *testing.T) {
	roles := map[string]Role{
		"Alice": RoleMurderer,
		"Bob":   RoleDoctor,
		"Carol": RoleCivilian,
		"Dave":  RoleCivilian,
	}
	alive := map[string]bool{
		"Alice": true, "Bob": false, "Carol": true, "Dave": true,
	}

	tests := []struct {
		name   string
		filter func(Role) bool
		want   int
	}{
		{"all alive", nil, 3},
		{"alive murderers", func(r Role) bool { return r == RoleMurderer }, 1},
		{"alive non-murderers", func(r Role) bool { return r != RoleMurderer }, 2},
		{"alive doctors (none)", func(r Role) bool { return r == RoleDoctor }, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := AliveCount(roles, alive, tt.filter)
			if got != tt.want {
				t.Errorf("AliveCount() = %d; want %d", got, tt.want)
			}
		})
	}
}

func copyRoles(m map[string]Role) map[string]Role {
	out := make(map[string]Role, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
