# usage-bar

Animated bars under the Claude Code prompt for your 5-hour and 7-day usage limits.
Each bar shows the percent used, a reset countdown (`↻`), a pace mark (`┃`) where
usage would be if spent evenly across the window, a projection of where the window
will end at the current burn rate (`→71%`), and how much the last answer added (`+0.6`).

Styles: `pacman`, `beer`, `tank`, `battery`, `hourglass`. Switch with
`/usagebar <style>`; the choice is remembered. It needs a Claude subscription, since
the limits come from the rate-limit readings Claude Code reports after each response.

## Install

At the prompt of a terminal session:

```
/plugin install usage-bar --marketplace Vugatso/plugin_usage_bar
```

From a shell:

```
claude plugin install usage-bar --marketplace Vugatso/plugin_usage_bar
```

Answer `y` to add the marketplace, then choose the user scope so it shows in every session.
In the desktop app, where `/plugin` does not run: click + next to the prompt box, then
Plugins, Add marketplace with `Vugatso/plugin_usage_bar`, then Add plugin.
