package game

// ResolveNight computes the night outcome.
// If doctor saved the kill target, no one dies (Saved=true).
// Callers apply the returned Victim to the alive map themselves.
func ResolveNight(actions NightActions, roles map[string]Role, alive map[string]bool) NightResult {
	result := NightResult{}

	if actions.Kill != "" {
		if actions.Save == actions.Kill {
			result.Saved = true
		} else {
			result.Victim = actions.Kill
		}
	}

	if actions.Inspect != "" {
		result.Inspected = actions.Inspect
		result.InspectedRole = roles[actions.Inspect]
	}

	return result
}
