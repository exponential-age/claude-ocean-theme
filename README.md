# Ocean Tide

A Claude theme for the desktop and mobile apps: an ocean at the bottom of the chat that tracks the real sky and how full your context window is.

- **Ocean colors.** Deep navy at night and sea-mist by day, with sea-foam and sunset-orange accents and easy-to-read text.
- **Waves that track context.** Slow, subtle waves along the bottom of the screen. They start calm and get bigger and rougher as the chat's context window fills: a gentle swell at 20%, choppy at 40%, rough at 60%, and whitecaps at 80%. At 80% you also get a one-time pop-up suggesting a new chat.
- **A real sky.** The sun and moon sit where they really are, computed for Los Angeles in Pacific time. The moon shows its real phase. The theme switches to light mode at sunrise and dark mode at sunset, with dawn and dusk colors in between.
- **Status line.** Shows the sea state, how full the context is, and the next sunrise or sunset.

The terminal shows only the status line; the theme and animation draw in the Claude desktop and mobile apps.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ocean-tide --marketplace exponential-age/claude-ocean-theme
```

From a shell:

```bash
claude plugin install ocean-tide --marketplace exponential-age/claude-ocean-theme
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `exponential-age/claude-ocean-theme`, then Add plugin.

Answer `y` to add the marketplace, then pick a scope (user scope makes it your default in every session).

## Commands

- `/ocean`: today's sunrise and sunset, and the current sea state
- `/ocean sea 0-4`: preview a sea state (4 = whitecaps)
- `/ocean time 18:45`: preview the sky at a Pacific time today
- `/ocean live`: back to the real context fill and the real time

## Settings

To use a different location or different thresholds, edit the top of `hooks/register.tsx`:

- `LAT` and `LNG`: where the sun and moon are computed for (Los Angeles by default)
- `THRESHOLDS`: the context percentages at which the sea steps up (`[20, 40, 60, 80]`)

While the theme is on, it sets light or dark mode itself, following the sun.
