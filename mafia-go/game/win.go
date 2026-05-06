package game

// CheckWin returns the winner, or WinnerNone if the game is still ongoing.
//
// Mirrors mafia2.js checkWin:
//   - Civilians win if the murderer is dead.
//   - Murderer wins if alive non-murderers <= 1 (murderer >= civilians).
func CheckWin(roles map[string]Role, alive map[string]bool) Winner {
	murdererAlive := false
	civilianAlive := 0
	for name, r := range roles {
		if !alive[name] {
			continue
		}
		if r == RoleMurderer {
			murdererAlive = true
		} else {
			civilianAlive++
		}
	}
	if !murdererAlive {
		return WinnerCivilians
	}
	if civilianAlive <= 1 {
		return WinnerMurderer
	}
	return WinnerNone
}
