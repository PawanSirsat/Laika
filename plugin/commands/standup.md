---
description: What you did on your Laika board in the last 24 hours
allowed-tools: Bash(bash:*)
---

!`bash "${CLAUDE_PLUGIN_ROOT}/scripts/laika-standup.sh"`

Report the output above as-is.

**Read what it says about scope before summarising it.** There is no "my
activity" endpoint — the script reads the organisation's feed for the last 24
hours and selects the rows whose actor is the signed-in user. If it says the
window returned a full page, older rows were not read, and the summary must not
imply the list is complete.

Do not add anything from this session's memory. If the user did work that Laika
never recorded, it is not in the feed and it does not belong in a standup drawn
from it.
