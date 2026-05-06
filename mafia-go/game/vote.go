package game

import "fmt"

const voteDefer = "defer"

// ResolveVote tallies day votes and returns the elimination result.
// Defer votes are excluded. Ties produce no elimination.
func ResolveVote(votes map[string]string, roles map[string]Role) VoteResult {
	tally := map[string]int{}
	for _, target := range votes {
		if target != "" && target != voteDefer {
			tally[target]++
		}
	}

	if len(tally) == 0 {
		return VoteResult{Announcement: "No votes cast — no elimination."}
	}

	max := 0
	for _, count := range tally {
		if count > max {
			max = count
		}
	}

	var leaders []string
	for name, count := range tally {
		if count == max {
			leaders = append(leaders, name)
		}
	}

	if len(leaders) > 1 {
		return VoteResult{Tied: true, Announcement: "Tied vote — no one eliminated."}
	}

	elim := leaders[0]
	role := roles[elim]
	var ann string
	if role == RoleMurderer {
		ann = fmt.Sprintf("%s was eliminated. They were THE MURDERER! 🔪", elim)
	} else {
		ann = fmt.Sprintf("%s was eliminated. They were a %s.", elim, role)
	}
	return VoteResult{Eliminated: elim, Announcement: ann}
}
