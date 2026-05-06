package game

import "fmt"

// ValidateRoles checks that the role map is valid for starting a game:
//   - at least MinPlayers players
//   - exactly one murderer, one doctor, one investigator
//   - every player has a non-empty, known role
func ValidateRoles(roles map[string]Role) error {
	if len(roles) < MinPlayers {
		return fmt.Errorf("need at least %d players, got %d", MinPlayers, len(roles))
	}
	counts := map[Role]int{}
	for name, r := range roles {
		if r == "" {
			return fmt.Errorf("player %q has no role assigned", name)
		}
		switch r {
		case RoleMurderer, RoleDoctor, RoleInvestigator, RoleCivilian:
		default:
			return fmt.Errorf("player %q has unknown role %q", name, r)
		}
		counts[r]++
	}
	for _, special := range []Role{RoleMurderer, RoleDoctor, RoleInvestigator} {
		if counts[special] != 1 {
			return fmt.Errorf("need exactly 1 %s, got %d", special, counts[special])
		}
	}
	return nil
}

// AliveCount returns the count of alive players matching the given role filter.
// Pass nil to count all alive players.
func AliveCount(roles map[string]Role, alive map[string]bool, filter func(Role) bool) int {
	n := 0
	for name, r := range roles {
		if alive[name] && (filter == nil || filter(r)) {
			n++
		}
	}
	return n
}
