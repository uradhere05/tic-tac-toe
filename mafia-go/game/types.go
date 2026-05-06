package game

// Role represents a player's role in a mafia game.
type Role string

const (
	RoleMurderer     Role = "murderer"
	RoleDoctor       Role = "doctor"
	RoleInvestigator Role = "investigator"
	RoleCivilian     Role = "civilian"
)

// Phase represents the current game phase.
type Phase string

const (
	PhaseNight Phase = "night"
	PhaseDay   Phase = "day"
	PhaseVote  Phase = "vote"
	PhaseEnded Phase = "ended"
)

// Winner represents the winning side.
type Winner string

const (
	WinnerNone      Winner = ""
	WinnerCivilians Winner = "civilians"
	WinnerMurderer  Winner = "murderer"
)

// MinPlayers is the minimum number of players required to start.
const MinPlayers = 5

// NightActions holds the actions submitted during the night phase.
type NightActions struct {
	Kill    string // murderer's target
	Save    string // doctor's target
	Inspect string // investigator's target
}

// NightResult is the outcome of resolving a night phase.
type NightResult struct {
	Victim        string // empty means no kill
	Saved         bool   // true if kill was blocked by doctor
	Inspected     string // player investigated (empty if none)
	InspectedRole Role   // role of the inspected player
}

// VoteResult is the outcome of resolving a vote phase.
type VoteResult struct {
	Eliminated   string // empty means no elimination
	Tied         bool
	Announcement string
}
