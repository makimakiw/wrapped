# Third Act Weekly Wrap

Spotify Wrapped-stil sammanfattning av Third Acts vecka — rolig design, riktig data.

## Datakällor

| Källa | Status | Auth |
|-------|--------|------|
| **GitHub** (`third-act`) | ✅ | `gh` (Schultzan) |
| **Trakka** | ✅ | `trakka login` |
| **Azure DevOps** | ✅ | macOS Keychain (`dev.azure.com`) eller `AZURE_DEVOPS_EXT_PAT` |
| **Teams / M365** | ✅ | `m365 login` (engångs) |
| **Cursor** | ⏳ | `CURSOR_API_KEY` i `.env` |

## Snabbstart

```bash
npm run fetch    # ~2.5 min (senaste 7 dagarna, inkl. helg)
npm run serve    # http://localhost:3456
```

## Veckovis uppdatering (fredagar 09:00)

Data hämtas **inte** automatiskt från Vercel — perioden räknas som rullande **7 dagar** (inkl. lördag/söndag) i `Europe/Stockholm`.

```bash
npm run weekly   # fetch + commit + push + Vercel deploy
```

**Mac (rekommenderat)** — kör med dina lokala `gh` / Trakka / M365 / Azure-credentials:

```bash
cp scripts/com.thirdact.weekly-wrap.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.thirdact.weekly-wrap.plist
```

Logg: `~/Library/Logs/thirdact-weekly-wrap.log`

**GitHub Actions (valfritt)** — workflow `.github/workflows/weekly-wrap.yml` körs fredagar 07:00 UTC (= 09:00 svensk sommartid). Kräver repo-secrets: `GH_TOKEN`, `AZURE_DEVOPS_EXT_PAT`, `CURSOR_API_KEY`, ev. `TRAKKA_TOKEN`, `VERCEL_TOKEN`.

## Azure (automatiskt om du git-clonat från Azure)

Projektet läser PAT från **git credential keychain** (`dev.azure.com`) — samma credentials som `git clone` mot Azure DevOps. Ingen `az` CLI krävs.

Alternativ: `export AZURE_DEVOPS_EXT_PAT="..."`

## Teams (Microsoft 365)

Engångs-setup i terminal:

```bash
npm install -g @pnp/cli-microsoft365   # redan installerat om m365 finns
m365 setup                             # välj interaktiv, spara standard-app
m365 login --authType deviceCode       # logga in med @thirdact.se
npm run fetch
```

Wrapped hämtar då:
- Meddelanden i **alla** Teams-kanaler du har access till (17 team)
- **Gruppchattar** (208 st) filtrerade på veckans datum
- Veckans citat från Teams

## Cursor

Två typer av API-nycklar (Cursor Dashboard → Settings → API Keys):

| Nyckeltyp | Scope | Ger i Wrapped |
|-----------|-------|----------------|
| **Team Admin** | `admin:*` | Hela teamets usage: AI-requests, accepterade rader, favoritmodell per person |
| **Cloud Agents** (din nuvarande) | Personlig | Cloud agents, tokens, kopplade repos — **inte** team-wide IDE-usage |

```bash
cp .env.example .env
# Lägg nyckeln i .env — committa aldrig .env
npm run fetch
```

För rik teamstatistik (vem körde mest Agent/Composer den veckan): skapa en **Admin API key** med `admin:*`-scope. Din personliga Cloud Agents-nyckel räcker för att visa kopplade `third-act`-repos och eventuella cloud agents.

## Äkthet

Varje kort märks **✓ Riktig data** eller **○ Platshållare** i UI:t.
