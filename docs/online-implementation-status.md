# BFW Online Implementation Status

Updated 2026-10-16. The source of requirements is the attached goal objective and the technical notes under `BFW Online — Техническая документация`.

## Movement energy correction — 2026-10-16

- Positive energy/speed bonuses reduce movement energy cost in local and online play. All-stat effects, Doggo movement triggers and expiry, GendaBoss on existing/future creatures, Hopium, flip triggers, and the shield-dependent Glyphid Guard bonus use this direction.
- `effectiveUnitSpeed` enforces a minimum paid cost of 1, including External Paradise reductions. Only cards with original `card.Speed === 0` may cost 0. Unclamped internal modifiers preserve correct stacking and removal of temporary effects.
- An explicit negative speed modifier increases movement cost. The existing attack-to-speed adjustment in `applyCombatStatChanges` is preserved.
- Web production build and server type checking pass. Shared core and local card-effect checks: 535 tests pass, including movement payment, original-zero exceptions, stacked buffs and temporary expiry. Browser gameplay was not rerun for this correction.

## Online deck selection — 2026-10-16

- Saved decks in a waiting room appear as preview tiles with native radio inputs. Selection is sent immediately; the random-deck form and separate confirmation button are removed. Drafts remain visible but cannot be selected.
- New rooms automatically select the last played, still playable deck, or the first playable deck. History is recorded only after receiving a match snapshot and is stored per account in this browser's local storage. Reconnecting to an existing room preserves its current selection.
- Mode selection loads and validates saved account decks with the shared deck validator. Both mode buttons stay disabled while loading, on load failure, or when no playable deck exists; the page offers a retry or the deck editor. Guests retain the three starter decks.
- The editor and lobby share the complete paginated deck loader and preview data. Existing browser scripts use the new radio controls. Web build/type checking passes; automated tests and browser gameplay were not run for this UI change.

## Stage 1: Baseline and engine boundary

- `pnpm run build`: passes. Existing warning: generated JS chunk exceeds 500 kB.
- `node --experimental-strip-types --test src/card-effects.test.mjs`: 233/233 pass. Updated extracted-App test contexts for current selection and turn-draw state, and replaced one stale source-string assertion with a rule-check assertion.
- Active catalog: `reference/cards.json`, 578 records, 578 unique UUIDs; 209 cards lack the `в разработке` tag. `apps/web/src/App.vue` imports it and `/cards/<name>.png` is the public art URL pattern.
- `src/cards-data.json` has 37 records and no code/test consumer. It is retained as an unreferenced legacy file pending a safe migration point because this supplied workspace had no prior Git history to recover a deleted user file from.
- Engine boundary in `apps/web/src/App.vue`: `begin` line 124; `draw` 137; `startTurn` 199; `play` 281; `spell` 292; `useAbility` 345; `resolveAbility` 348; `move` 352; `resolveTrap` 353; `resolveCrown` 354; `attack` 355; `damage` 359; `kill` 367; `finishTurn` 412. Card-specific choice handlers are concentrated in lines 138–197 and 262–280; end-turn choice guards are in `end` line 421.
- The local combat attack depth and pending-death queue now live in `src/local-attack-resolution.ts` state held by the local match and recreated by `begin()`. A focused test verifies two such match contexts stay isolated. Other local rules still read Vue refs and call UI feedback/animation helpers; the engine is not yet fully extracted.
- `packages/game-core/src/card-effects.ts` now contains the extracted reusable operations and pure helpers. It has no Vue/DOM/timer dependency and its shuffle helper accepts an injected random source. Preserve Crown → Trap → Death resolution order in `attack`.
- This directory had no `.git`. Local Git metadata has been initialized; Git commands use a per-command `safe.directory` because the sandbox identity differs from the folder owner. There is no remote and no baseline commit.

## Implementation begun

- Added `packages/game-core/src/deck.ts`; local deck validity now calls this shared validator.
- Added focused tests for the exact 30-card rarity split, one or two classes, allowed cards, copy cap, canonical catalog UUID uniqueness, and a valid selection from the real catalog.
- Added `createMatch` with validated 30-card snapshots, isolated player/pile state, server-injected randomness, the existing opening hand/resource setup, and `projectForPlayer` with an allowlist that omits both deck orders and the opponent hand. At this stage, local game setup called the shared match initializer, while turn rules and effects still lived in the then-root `src/App.vue`.
- `pnpm run test:game-core`: 10/10 pass, including match initialization, invalid-deck rejection, private projection, command concession, and two-match isolation.
- `pnpm run build`: passes; Vue type-check passes. Existing generated JS chunk warning remains (>500 kB).
- Room start now validates both ready users' current deck revisions, locks deck rows against concurrent edits, creates a server-randomized `MatchState`, and writes the match plus both player/deck snapshots in one PostgreSQL transaction before publishing `match.started`. Concurrent start requests are serialized per room; write failure rolls back and leaves the room in the lobby.
- Added a membership-checked private snapshot endpoint for reconnects and an initial hand/resource view in the lobby. Projections allowlist public player fields and omit the board and raw log until those have a safe public event model.
- Added `packages/contracts` runtime checks for protocol hello, match subscribe/resync, and the currently supported `match.concede` command. Other game action messages return `UNSUPPORTED_ACTION`.
- Added a transactional concede path: membership and receipt lookup precede version checking; accepted state, version, winner, and command receipt commit together; duplicate IDs return the receipt without a second transition; stale versions return a private snapshot; commit failure produces no ack. Match completion resets readiness and returns the room to its lobby.
- The browser can submit concession with a UUID command ID, preserve it across reconnect, and update from private server snapshots. Outbound snapshots over 1 MiB and slow socket buffers over 2 MiB close the affected client.
- `node --experimental-strip-types --test packages/contracts/src/*.test.mjs packages/game-core/src/*.test.mjs`: 12/12 pass. `node --experimental-strip-types --test apps/server/test/*.test.mjs`: 30/30 pass, including command deduplication and actor/payload conflict, stale version, membership-only snapshots, commit failure, room start, deck edit conflict, and slow client limits. Server TypeScript and Vue type checks pass; Vite build passes with the existing >500 kB chunk warning.
- Added `packages/game-data` as a workspace package exporting the existing canonical catalog and `RULES_VERSION = '1'`; no catalog copy was made.
- Moved `card-effects.ts` under `packages/game-core`; the Vue client and existing effect suite now import that shared module.
- Added pnpm workspace package discovery. Root app remains in place until its move to `apps/web` can be done with its config, asset paths, and scripts together.
- `pnpm run test:game-core`: 5/5 pass, including random legal deck generation.
- After moving effect helpers, `node --experimental-strip-types --test src/card-effects.test.mjs`: same 225/233 baseline; no new failures.
- `vue-tsc --build`: passes.
- Vite build to the task visualization output directory: passes with the existing >500 kB warning.
- Existing card-effects suite remains at its baseline 225/233; no new failing test appeared.
- Created `apps/server` with Node 24 native TypeScript stripping, Fastify, PostgreSQL pool, WebSocket and multipart plugins.
- Added `GET /health/live` and DB-backed `GET /health/ready`; liveness stays independent of PostgreSQL.
- Added username/display-name/password input validation and unit coverage, including Unicode code-point counting and control rejection.
- Added first forward-only PostgreSQL migration for accounts, sessions, processed avatars, catalog, decks, matches, player snapshots, and command deduplication. Username immutability is enforced by a database trigger.
- Added a migration runner with a PostgreSQL advisory lock, per-migration transactions, rollback, and tracked filenames.
- Added registration, login, session lookup, CSRF token retrieval, profile read/update, password change, and logout endpoints. Session tokens are 256-bit opaque cookies; only SHA-256 token hashes are stored. Passwords use Argon2id; rate limits cover IP and normalized login, and concurrent Argon2 work is bounded. Password changes revoke other sessions and rotate the current cookie.
- Added public catalog and private deck list/detail/create/update/delete APIs. Writes enforce exact Origin + CSRF, ownership, a 100-deck quota, optimistic revisions, atomic replacement, draft rules validation, and the shared `validateDeck` rules. A catalog seed step upserts definitions and deactivates cards removed from the current data set.
- Added an in-memory `RoomManager` for connected seats, 8-character invitation codes, two-player limits, deck readiness/revision checks, guest exit, and creator/guest reconnect deadlines. Personal room updates keep each player's selected deck private.
- Added `/ws` cookie + Origin validation, protocol hello, heartbeat, periodic session revalidation, and disconnect handling. Added HTTP room create/current/join/view/select/ready/leave routes and reconnect timeout cleanup; active matches are aborted on restart or timeout.
- Added an Online Lobby entry in the current Vue app with login/registration, random legal deck creation, room code join/create, deck selection, and readiness. Vite proxies `/api` and `/ws` to the server for local development.
- Added profile avatar upload, replacement, and removal in the lobby. The server validates and normalizes images to metadata-free 256×256 WebP, caps input/output and concurrent decodes, and commits image plus version in one transaction. Public versioned reads support ETag and stale-version redirects; failed replacements preserve the previous avatar.
- Added profile forms for display-name updates and password changes. Password changes require the current password, update the session CSRF token after cookie rotation, and clear password fields; password recovery remains unavailable and is disclosed in the profile menu.
- Avatar routes and processing tests pass; the complete server suite now passes 37/37. Contracts/game-core pass 19/19, and server TypeScript, Vue type-check, and Vite production build pass.
- Match projections now include the public board through an explicit card/unit allowlist, and the online lobby renders its confirmed positions and visible statuses. A projection test verifies internal card fields and per-unit effect counters stay private. Contracts/game-core now pass 13/13.
- The initial match now grants seat 0 the correct round-one 1 mana and 1 energy; the opponent starts at 0 until their turn. This aligns the persisted snapshot with local `startTurn` rules.
- Added a local/full-stack Compose definition, separate PostgreSQL bootstrap/app/migration roles, a Node API image, a Caddy client image and same-origin HTTP/WebSocket routing. PostgreSQL 18 data and Caddy certificates use named volumes; the README documents local startup and production image inputs. Both production and dev Compose configurations parse successfully.
- Migration runner now prefers `MIGRATION_DATABASE_URL` and keeps `DATABASE_URL` fallback for existing setups. Server suite passes 37 tests; contracts/game-core pass 19; the combined run passes 56.
- Added `turn.end` to the runtime protocol and authoritative game-core. It checks whose turn it is, enforces the no-play choice rules, uses stable card instance IDs for discard, draws to the next player's hand limit, grants round resources, and commits one new match version. The online lobby exposes the end-turn choices. A server transaction test covers commit and duplicate retry.
- Added `unit.move` to the strict runtime contract, authoritative game-core, transactional server command path, and keyboard-operable lobby board. It checks owner/active turn, summon timing, stun/flip and movement locks, blocked units, legal neighboring cells, occupancy, and effective energy cost; one event and version change are stored atomically, with duplicate retries spending no additional energy. Contracts/game-core pass 23/23 and server tests pass 38/38. Movement-trigger effects are not yet represented in `MatchState`; online card play remains unavailable, so matches still cannot populate the board through the UI.
- Added `card.play` for creature and building placement to the strict protocol and authoritative transaction path. It uses card instance IDs, validates the player hand, turn, placement row, occupancy, supported type, entry-effect boundary, and payment; creature mana discounts and the health-payment rule for `Империя крови` reuse existing helpers. Placement updates the private hand, public board, played flag, version, and receipt atomically. The lobby can select a card and cell using labeled 44px keyboard-operable buttons. Cards whose entry/on-play triggers are not ported, plus items and spells, are rejected without charging resources. Contracts/game-core pass 28/28 and server tests pass 40/40.
- Added `item.equip` end to end. A card in hand can be equipped to a creature without an item; cost and health payment follow existing rules, item stats and shields update the unit, and item identity is exposed in the public snapshot through an allowlist. The lobby supports selecting a creature target and displays its equipped item. Items with entry, crown, trap, ability, gamba, death, movement-trigger, or start-of-turn effects reject before payment until those rules are online. Contracts, core, and server suites pass 51/51 together.
- Added `spell.cast` for self-contained spells that heal players/creatures or deal direct damage to the opponent, including the existing combined damage-and-heal wording. Cost, Мкия discount, Blood Empire health payment, burn handling, Pink Diamond shields, Ame attack rewards, and match victory reuse current game-core rules. The lobby exposes only implemented descriptions. Unsupported effects reject before payment. Contract, core, and server tests pass 93/93 together.
- `turn.end` now resolves simple start-of-turn effects for mana/energy gains and player health changes, including “every turn” sources owned by either player. Effect order follows board order; lethal triggers finish the match. Effects requiring draws, choices, gamba, movement, or shields reject the transition without changing the match. Tests cover incoming-turn bonuses, every-turn ownership, lethal victory, and rejection without mutation.
- `card.play` resolves simple entry resource gains, owner healing, and conditional direct opponent damage using the card's score and saved-creature conditions. Entry effects requiring choices, draws, or other unported state still reject before payment; named entry flows with local-only pending choices are also rejected.
- Latest combined contract, game-core, and server run: 99/99 pass. `vue-tsc --build`, server TypeScript, and `vite build` pass. The local App-extraction suite still reports the 8 previously recorded failures.
- Added `unit.attack` through the strict contract, game core, transactional command handler, and lobby board. Ordinary attacks check ownership, activity, range, invisibility, attack count, and current counterattack rules; supported shield, damage reduction, immunity, burn/discard, kill reward, and player-health-on-hit behavior update the authoritative match. The board lets the active player select an own unit and click an enemy unit. Unsupported crown/trap/splash/death-choice effects reject atomically. New contract/core/server checks pass 36/36 together.
- Added `unit.attackPlayer` end to end. A ready creature on the opponent's home row can deal its normal direct attack damage, respects the attack limit and cards that cannot hit players, clamps health at zero, and finishes the match with the proper winner. The lobby exposes an accessible button when the selected friendly creature is on that row. Crown triggers still reject atomically. The focused contract/core/server suites pass 40/40.
- Added `ability.use` end to end for the four self-contained ability operations already recognized by game-core: gain a black token, gain mana, gain a shield, and store splash damage for the next attack. Mana and black-token costs, once-per-turn/repeatable use, versioning, and duplicate retries are enforced server-side. The attack resolver now applies stored splash damage to the target and adjacent creatures. Ability-use status is included in the public board projection so spent actions disappear from the lobby. Unsupported targeted/choice abilities reject without cost. Contracts, core, and server suites pass 46/46 together.
- Added private `choice.resolve` handling for an entry effect that fully heals a selected creature. Only the owner sees the allowed targets; the match blocks other commands until resolution, then commits the heal and deferred entry tokens as one version. Healing reuses the Pink Diamond shield and Ame reward rules. Server receipts deduplicate a repeated resolution.
- Latest contracts/game-core run: 56/56; server suite: 46/46; Vue type-check, server TypeScript, and Vite production build pass. The extracted local card-effects suite still has the 8 previously recorded baseline failures.
- Combat deaths now resolve explicit `heal-player` and `damage-player` death operations before removing the dead unit. Lethal damage records a normal match victory; unsupported death operations continue to reject the whole attack. Added core and transactional duplicate-retry coverage.
- Latest contracts/game-core run: 58/58; server suite: 47/47; Vue type-check, server TypeScript, and Vite production build pass.
- Ordinary and direct-to-player attacks now resolve the cataloged crown effects for draw, mana, black tokens, player/attacker healing, and player damage. Crown text must match the supported operations; mixed lines and other trigger types still reject before changing state. Duplicate attack delivery cannot repeat a draw.
- Latest contracts/game-core run: 62/62; server suite: 48/48; Vue type-check, server TypeScript, and Vite production build pass.
- Attacks now resolve the simple damage traps for the attacking unit and the attacking player, in crown → trap → death order. Trap damage to a unit uses the shared shield/reduction rules; lethal player damage finishes the match. Flipped defenders do not trigger traps. Destructive, control-changing, and multi-choice traps still reject atomically.
- Latest contracts/game-core run: 64/64; server suite: 48/48; Vue type-check, server TypeScript, and Vite production build pass.
- Added the cataloged destroy-attacker and take-control-attacker traps. Destroyed attackers enter the same death/discard/reward resolution as combat deaths; transferred units change owner in the authoritative snapshot and duplicate commands return the original receipt. Unsupported transfer-item and choice traps still reject.
- Latest contracts/game-core run: 65/65; server suite: 49/49; Vue type-check, server TypeScript, and Vite production build pass.
- Combat now queues every unit made lethal by the attack, counterattack, splash, or trap, preserving the source of its lethal damage for kill rewards. Splash deaths now receive normal discard, burn, and supported death-effect handling instead of remaining at zero health on the board.
- Latest contracts/game-core run: 66/66; server suite: 49/49; Vue type-check, server TypeScript, and Vite production build pass.
- `ability.use` now starts a private, versioned target choice for the cataloged creature-heal ability. The command pays mana and marks the ability used once; `choice.resolve` validates the private target, heals it, applies shield/Pink Diamond/Ame behavior, and commits as a second version. Other seats receive no choice options or target ID in the start event; retries deduplicate both steps.
- Latest contracts/game-core run: 67/67; server suite: 50/50; Vue type-check, server TypeScript, and Vite production build pass.
- `Пудж` can use its cataloged targeted ability online: mana and ability use commit once, private choices include only creatures that can be moved into the socket in front of Пудж, and resolution/retries move the selected creature once.
- Latest contracts/game-core run: 68/68; server suite: 51/51; Vue type-check, server TypeScript, and Vite production build pass.
- Creature movement now grows every other `Догго` by one attack, speed, health, and max health; `turn.end` removes the accumulated bonus, including lethal expiry with burn/save handling. Repeated movement and end-turn command IDs do not duplicate the stat changes.
- Entering a `Турель`'s orthogonal range now applies its two damage after movement, including shield, damage-reduction, flipped `Буня`, `Бёрдли`'s death flip, simple death, and burn/save rules. Unsupported lethal death effects reject the transaction.
- Latest contracts/game-core run: 70/70; server suite: 52/52; Vue type-check, server TypeScript, and Vite production build pass.
- `Игла`'s two ready multi-target abilities now use a private three-target choice. The player pays the two black tokens once, selects three distinct creature/building targets, and applies damage or healing through server rules; damage includes supported shields, reductions, death handling, and kill rewards. The runtime contract validates bounded, duplicate-free target lists.
- `Абрамс`'s cataloged move-to-selected-socket ability now opens a private choice of free board cells. The server rechecks occupancy and movement locks when resolving it, moves Abrams, and stuns adjacent creatures; payment and retries remain transactional.
- `Тонатий` can pay for his cataloged swap ability, privately choose another creature, and exchange positions with it. The movement lock is enforced before payment and selection; resolution is atomic and command retries do not repeat the swap.
- `Рокировочка` now uses a private two-creature choice. The spell and payment commit before selection, both targets must still be distinct living creatures, and resolution swaps their positions in one transaction.
- `Догго` movement buffs and `Турель` range-entry damage now share one resolver across ordinary movement, Пудж and Абрамс movement abilities, Тонатий's swap, and Рокировочка. Unsupported lethal Turret effects still reject the full command atomically.
- Supported start-of-turn effects can now draw the stated number of cards from the source owner's deck before the regular hand-limit refill. The source owner's hand, deck order privacy, transaction receipt, and duplicate retry behavior are covered.
- Cataloged start-of-turn forward movement (including `Погань`) now checks global/unit movement locks and forward-cell occupancy, then uses the shared Doggo/Turret movement triggers. The test covers the move, Turret damage and Doggo buff.
- Start-of-turn burn effects now pause for a private card selection, burn/save the selected cards once, then resume queued start-turn effects and the normal hand refill. The queue handles source-owner effects even when the other seat starts; retries and opponent privacy are covered.
- The `Генератор щита` turn-start effect now offers only eligible adjacent allied creatures as private targets, revalidates the target on resolution, grants the shield, and resumes the turn queue. The server integration test verifies privacy and retry deduplication.
- `Чёрная меза` now proves ordered start-turn draw then conditional private burn when the hand limit is at least five; one turn-end transition and a separate choice resolution persist atomically and deduplicate retries.
- `Хаешка` now accepts a selected board socket and deals its cataloged 3×3 creature damage through the shared shield and death resolver. The socket is runtime-validated; buildings are unaffected, and an unsupported lethal death effect rejects atomically without charging the spell.
- Four narrowly parsed selected-target spells now resolve creature damage (with cataloged self-heal/self-damage where present), and allow direct opponent targeting only when the text permits it. Targets are revalidated before payment and through the shared damage/death resolver.
- `Починка` now fully heals active allied creatures and buildings, including the existing Розовый Алмаз shield and Аме attack triggers; enemy, dying, and flipped cards are excluded.
- `@everyone` now damages every creature on both sides through the shared shield and death resolver. The server retry test confirms duplicate `commandId` does not repeat damage.
- `Новый видос` now heals its owner and burns itself correctly, including the catalog's inline misspelling and same-line burn marker. UI and server strip either burn-marker spelling consistently before parsing the standalone effect.
- `Брэпси` now applies its cataloged 10-point owner heal and burns itself; a server test confirms the heal and burn remain single-application across duplicate command retries.
- `Город без души` now selects and destroys a building, bypassing its shield but resolving supported death effects through the shared death path. Complex unsupported death effects reject the whole cast before payment; server retries do not destroy twice.
- `Кик` now sends a selected living creature/building and its item to their owner's discard without running death effects. `Мут` returns the selected card to its owner and applies the attached item's burn/save rule.
- Latest online core/contracts tests: 96/96; server suite: 68/68; legacy local effects suite: 237/237. Vue type-check, server TypeScript, and Vite production build pass.
- Security projection follow-up: public unit IDs and `card.played`, `item.equipped`, and `spell.cast` events no longer expose private card-instance IDs. Face-down cards expose only their position, owner, placeholder, and flip counter; hidden identity/stats/items are redacted, and targeted building destruction rejects a face-down card. Regression tests cover projection, events, and invalid hidden-target probing.
- Public player projections now include only each hand's card count. The online lobby shows the opponent's count and the local player's count/limit without receiving the opponent's cards.
- `Геймнайт` now draws up to two available cards and raises the opponent's public hand limit through that opponent's next turn. Expiring limit changes are stored in the match state and applied when that seat ends its turn; compound unsupported spell text rejects before payment. Transactional tests verify the duplicate command does not repeat either effect.
- `Гастер Бластер` now damages all active creatures sharing the selected card's row or column, through the normal shield/death resolver. The lobby blocks flipped cards as targets; a transactional retry test confirms the line damage applies once.
- `Лазанья` now buffs every non-flipped, non-dying creature/building in a selected cell's row or column. The empty-cell selector is supported by the lobby and protocol, and the server retry test confirms stats change once.
- `Бан` now targets a living, unflipped creature, bypasses shields, and resolves the normal supported death path while forcing the creature card to burn. The attached item follows its own burn/save rule; unsupported death text rejects before commit. Lobby selection and transactional retry tests cover the action.
- `Портал гравитации` now targets a living, unflipped creature online, applies its flip duration, and runs the existing flip trigger for the creature's owner. Lobby targeting and transactional retry tests cover trigger stats, draw, and mana.
- `Сгоревшие сервера` now burns every active creature through the shared death resolver, bypassing shields while skipping flipped creatures and buildings. The targetless lobby cast and duplicate retry are covered.
- `Закрытие бункера` now flips every living board card for the cataloged duration, resetting existing timers and resolving each card's flip trigger for its owner. The lobby accepts this targetless cast; core and transactional retry tests cover both seats.
- `Фанфик Магната` now heals an allied creature with the normal Pink Diamond/Ame healing triggers or stuns an enemy creature. Lobby targeting and transactional retry are covered.
- `Хопиум` now buffs a selected allied creature and kills it at the end of the owner's turn through the shared death resolver. Cast preflight rejects unsupported death text before charging; retry, expiry, and target death checks are covered.
- `@.hiho` now kills a selected living creature through the shared death resolver and burns the spell itself as its catalog marker requires. The lobby target filter and duplicate command test cover the cast.
- `Гнилое ворьё` now lets the player choose mana or energy; the server transfers up to the printed amount without taking the opponent below zero, then applies the cataloged spell burn. Invalid choices reject before payment, and duplicate command receipts do not repeat the transfer.
- `Перепись населения` now grants one mana and energy per other card in the caster's hand after the normal card payment. Its effect text is checked server-side and duplicate retries do not repeat the gains.
- `Засадка пустыни пшеницей` now stores black tokens on empty neutral sockets in match state, exposes them in the public projection and lobby, and awards the moving creature's owner one mana when it consumes a token. Movement through the shared resolver covers regular and supported effect-driven moves; retries do not duplicate tokens.
- `Swoon` now consumes its normal cost with or without a prior burn, but destroys the chosen creature only when its owner burned a card this turn. That flag appears only in the owner's private snapshot; lethal resolution is preflighted before payment and duplicate command retries do not repeat it.
- `Рейджбайт 10 из 10` now grants temporary rage to any selected living, unflipped creature and destroys it at the end of its owner's turn. The online lobby accepts either player's creature, and server/core tests cover exact owner-turn timing and duplicate command retry.
- `Миндальная вода` now heals the caster from its catalog wording, “Восстановите себе 4 здоровья”; the shared heal parser and online lobby recognize this form, and game-core verifies payment and discard.
- `5000 участников` now destroys all flipped board cards through the supported death resolver, then applies two turns of flip to each survivor and resolves its flip trigger. Preflight rejects unsupported lethal death effects before payment; server retries do not repeat the effect.
- `Ледяной шок` now preserves a target killed by its damage at zero health in its socket for two turns flipped; surviving targets take damage normally. The server uses its transactional command path, with retry and damage-boundary coverage.
- `Знаком по ебалу` now triggers a private one-card save choice when its damage kills a creature. The selected card moves from hand to saved; only the owner receives the options, and server retries neither expose nor repeat the selected card.
- Both `Х-Слеш` and `X-Слеш` now restore health equal to the target creature's pre-damage health when that hit kills it; no healing occurs on a survivor. Core and server tests cover both spellings, lethal/nonlethal hits, and retry deduplication.
- `Обсидиан пчёла` can activate its zero-cost self-destruction ability online; shared death resolution deals two damage to orthogonally adjacent active creatures, and unsupported collateral death effects reject before the ability commits.
- `Джон Фараон` now destroys the attacked creature via the shared crown/death resolver. Unsupported death effects still reject atomically, direct player attacks remain legal, and a target that was face-down at attack time does not activate its trap after destruction.
- `PGM Peridot` leaves a creature or building it kills flipped at 0 health for two turns; all online flipped-card timers now tick at that card owner's turn end, including lethal expiry, while the cataloged no-tick exception stays intact. Attack and turn-end retries are covered by command transaction tests.
- Online lobby snapshot updates now ignore stale versions and packets for another match, preventing REST re-sync and WebSocket event races from rolling the visible game state backward. A focused test covers stale, current, new-match, and empty-snapshot cases; CI runs it.
- Private choice IDs no longer derive from the spell's hidden hand-card instance ID, and start-turn hand-burn completion events expose only the number of cards selected. Core and server-command tests assert hidden card IDs are absent from the choice ID and returned events.
- `Lazerwygs34` now receives its cataloged +3 attack and +3 health on entry starting at round 10, matching the local rule; command retries do not apply the buff twice.
- `Hoppy` now creates a private entry choice to save any flipped board card; the option label uses only its socket, and resolving the choice moves the card to the caster's saved pile while discarding its item to its owner.
- `Half-life 3` now fixes its kill count from the number of flipped board cards, lets the caster privately select that many active creatures, and resolves each through shared death handling; the card burns as cataloged and command retries do not repeat deaths.
- Latest checks before the local combat extraction: contracts 13/13, game-core 122/122, server 93/93, local effects 241/241, and online snapshot 1/1 (470 total). Vue type-check, server TypeScript, and Vite production build pass; Vite reported a 597.99 kB minified JS chunk.
- After extracting the local attack-resolution context: contracts 13/13, game-core 122/122, server 93/93, local effects 241/241, online snapshot 1/1, and local combat 2/2 (472 total). Vue type-check, server TypeScript, and Vite production build pass; Vite reports a 598.18 kB minified JS chunk.
- Online play now accepts the cataloged `Админский арбалет`: it applies its -10 attack entry adjustment, resolves its shared creature-kill crown and attacker-kill trap, and retains the normal atomic command/death path. Exact item text is allowlisted; unrelated triggered items remain rejected. Core tests exercise equip, both triggers, death/discard, and server command retry deduplication.
- Latest checks after the crossbow addition: contracts 13/13, game-core 123/123, server 94/94, local effects 241/241, online snapshot 1/1, and local combat 2/2 (474 total). Vue type-check, server TypeScript, and Vite production build pass; Vite reports a 598.18 kB minified JS chunk.
- `Дюп` now works as an online item through all three cataloged effects: equip reduces its owner's hand limit, its crown raises the limit and grants a black token, and its ability accepts a validated +1/−1 score-threshold choice. The owner can see public black-token counts and choose the direction in the match UI; server command retries spend the token once.
- Latest checks after the `Булава` addition: contracts 13/13, game-core 126/126, server 96/96, local effects 241/241, online snapshot 1/1, and local combat 2/2 (479 total). Vue type-check, server TypeScript, and Vite production build pass; Vite reports a 599.13 kB minified JS chunk.
- `Булава` can now be equipped online; its cataloged crown effect adds one stun to the attacked creature through the normal attack snapshot. Direct attacks on a player remain valid and do not apply the creature-only stun. Core tests cover stacking and direct attacks, and the server command test verifies duplicate attacks do not stack the stun twice.
- `Сьюзи` can use her five-mana ability online: the server privately offers damageable board cards, and offers opponent health only when Сьюзи is on the enemy home row. Choice resolution uses shared damage/death rules; contract validation, target privacy, lethal victory, and duplicate command receipts are covered.
- `Закулисье` now offers a private creature choice online, pays its five-mana ability once, returns the creature to its owner's deck top, and discards its equipped item. Core and server tests cover privacy and duplicate-command behavior.
- `Noovse` can lock all opponent movement for the opponent's full turn. The public snapshot exposes who is locked, and the lobby disables empty-cell moves while showing the remaining turn boundary. The core unlocks at the locked player's turn end; core/server tests cover expiry, projection, and retry deduplication.
- `Лусио` now gives allied creatures 10 temporary health until the start of its owner’s next turn. The online board labels temporary health, and expiry removes it before resolving any resulting deaths. Core tests cover damage through the opponent’s turn and lethal expiry; server tests cover retry deduplication and public projection.
- `Библиотекарь` now privately asks for a 1/2/4 mana rarity, then a deck/discard pile and an eligible card. Payment and the printed 1–3 burn / 4–6 keep gamba resolve once after the final selection, with stored gamba bonuses, Diamond modifiers, burn saves, and burn triggers applied. Opponents receive no choice options or selected card identity.
- All direct WebSocket replies, including subscribe/resync snapshots, now share the outbound message-size and backpressure limits used for room updates. The transport test covers oversized replies and slow sockets.
- `Айсберг` can choose online to draw one card or raise the hand limit by one through the end of its next turn. The choice is private, uses the existing temporary-limit timer, and applies transactionally. Core/contract/server tests cover both options, privacy, and retries.
- `Биби` can privately choose an allied building to destroy and gain +4 attack until the end of its turn. Building death effects use the shared resolver, and the attack buff is visible in the public board projection and expires at the owner turn end. Core/server tests cover the restricted target set, normal discard, expiry, public projection, and retries.
- `Фанат геншина` resolves its cataloged 1–3 death / 4–6 +3 mana gamba online. The core accepts an injected random source, applies existing Diamond and stored gamba bonuses, and resolves death normally; command retries do not reroll. Tests cover both outcomes, modifiers, and retry deduplication.
- `Генератор потех` pays its two-mana ability and draws one card online, matching the local handler; the creature stays on the board. Core and server tests cover the effect and receipt-backed retry deduplication.
- `Тау-пушка` can be equipped and grants +1 attack when its cataloged ability is used; its cannon and bearer die when attack reaches 5, including on equip or another command effect. Core tests cover ability and equip threshold; server tests cover retry deduplication.
- `Конвейерное производство` now resolves its ordered discard, burn, save, and draw stages online. Each card choice is private and receipt-backed; tests cover insufficient hand size, burn/save handling, and retries at every stage.
- Latest checks after Сьюзи, Закулисье, Noovse, Лусио, Айсберг, Биби, Фанат геншина, Генератор потех, Тау-пушка, and Конвейерное производство: contracts 13/13, game-core 139/139, server 106/106, local effects 241/241, online snapshot 1/1, and local combat 2/2 (502 total). Vue and server TypeScript checks and Vite production build pass; Vite reports a 604.73 kB minified JS chunk.
- Latest checks after `Библиотекарь` and the WebSocket outbound-limit fix: contracts 13/13, game-core 141/141, server 108/108, local effects 241/241, online snapshot 1/1, and local combat 2/2 (506 total). Vue and server TypeScript checks pass; Vite production build passes with a 606.20 kB minified JS chunk and the existing 500 kB advisory.
- Simple spell draw text (`Возьмите карту` / `Возьмите N карт`) now resolves inside the authoritative spell transaction, including empty-deck draws. The lobby uses the same parser to expose these spells; core and server tests confirm normal payment/discard plus exactly-once receipt behavior.
- Latest combined run after simple-draw support: contracts 13/13, game-core 142/142, server 109/109, local effects 241/241, online snapshot 1/1, and local combat 2/2 (508 total). Vue/server TypeScript checks and Vite production build pass; Vite reports a 606.35 kB chunk advisory.
- Added `.github/workflows/ci-release.yml`: PR and push checks run the test suites, web/server type-checks, web build, and production Docker builds. Pushes to `master` publish SHA/branch tags to GHCR; `v*` tags publish semver tags and a GitHub release containing both image digests. GHCR publish and release jobs use restricted permissions and serialize publication.
- Health readiness now requires the initial schema migration to be applied; JSON request bodies are capped at 64 KiB.
- `pnpm run test:server`: 21/21 pass; this covers input rules, registration/session/profile behavior, deck validation, health and WebSocket origin/session boundaries, private room views/reconnect state, and migration lock/rollback behavior with fakes.
- `tsc -p apps/server/tsconfig.json`: passes.

## Constraints for the next stages

- Combat and triggered damage now share death-effect validation and execution for the supported subset. Card/equipment disposal precedes effects, preserving the local order needed by `Ноэль` and `Диохазавр`. Added death draw, self-save, top discard excluding self, and typed pile retrieval; `ДастАроникс`, `Горыныч`, `Ноэль`, and `Диохазавр` have catalog-based coverage. Ordinary deaths no longer consume the next-burn-save modifier, and combat equipment uses its normal burn trait.
- `ДастАроникс` and `Горыныч` now also resolve their full entry draw/pile retrieval effects. The server accepts only the supported complete entry line, preserves pile order, and projects the draw privately. Empty draws, unsupported extra actions, duplicate receipts, and commit failure are covered.
- The repetition rule from `Маринует мясо` is now a shared pure helper used by local and server death resolution; an active own source repeats creature effects twice without disposing the card twice. Combat adjacent death chains use the same resolver as spell/start effects.
- The real `Щит` item now equips online and refreshes the bearer shield at the start of the owner turn. Its known start text uses the existing owner reset; other source effects still pass the normal validation. Core/server tests cover equip, absorbed attacks, next-turn refresh, stats, and retries.
- Latest verification: contracts 15/15, game-core 183/183, server 121/121, local effects 241/241, online snapshot 1/1, local combat 2/2 (563 total). Vue/server TypeScript checks and Vite production build pass; the existing chunk advisory is 610.12 kB. Full-stack PostgreSQL/Compose and two-browser acceptance remain unverified. No Git upload.

- `Дедруби` now runs its real owner-turn weakest-creature burn through the shared parser and authoritative start queue. A unique weakest creature burns automatically; tied minimum health opens a private single-target owner choice. The shared local target helper determines eligibility, including positive-health flipped creatures and exclusion of the source. Burn saves, equipment disposal, normal death chains, later start choices, privacy, and receipt-backed retries are covered.
- `Аскетик` and `Зелёная` now resolve their real cataloged start-turn gambas on the server. Injected random sources, Diamond and stored gamba modifiers, self-death, allied creature/player healing, Rose Diamond shields, Ame rewards, enemy creature/building damage, and player lethals are covered. Randomness is passed through every start-queue resumption; duplicate receipts never reroll an accepted outcome.
- A finished match now stops the start queue before further choices, ordinary draw, or resource grants, including when a private Dedrubi resolution causes a lethal death effect.
- Latest verification: contracts 15/15, game-core 170/170, server 117/117, local effects 241/241, online snapshot 1/1, local combat 2/2 (546 total). Vue/server TypeScript checks and Vite production build pass; the existing chunk advisory is 610.09 kB. Full-stack PostgreSQL/Compose and two-browser acceptance remain unverified. No Git upload.

- Turn start now creates a private mandatory `hand-limit-discard` after the entire start-effect queue and regular draw complete. The active owner must discard exactly the surplus before any other game action; during-turn overflow remains allowed. Ordinary discard preserves the local descending-hand-index order and triggers no burn effects. The lobby offers exact-count selection without keep-all; owner-only options, source-burn resumption, more-than-25 selections, and receipt-backed retries are covered.
- Start effects are collected from the post-end-turn board, so a card removed by turn-end death cannot draw or run another start effect from the old state.
- Latest verification: contracts 15/15, game-core 157/157, server 114/114, local effects 241/241, online snapshot 1/1, local combat 2/2 (530 total). Vue/server TypeScript checks and Vite production build pass; the existing chunk advisory is 609.67 kB. A fresh Docker probe still cannot connect to the Engine; real PostgreSQL/Compose and two-browser match acceptance remain unverified. No Git upload.

- `Разбан` and `Ого какой большой огурец` now pay for a private pile-search choice and finalize the spell only after the owner selects an eligible card, preserving the local draw-before-spell-disposal order. Empty eligible pools still complete normally. Search options are sorted independently of pile order, including Librarian options; the selected instance never appears in public events.
- Added `card.takeSaved` end to end: an active player can take an own saved card into hand for free, without marking it as played. Own saved cards are projected through a card-field allowlist and the lobby shows retrieval buttons. The server enforces turn, ownership, pending choices, versioning, and receipt-backed duplicate handling.
- Latest verification after pile search and saved-card retrieval: contracts 14/14, game-core 151/151, server 113/113, local effects 241/241, online snapshot 1/1, local combat 2/2 (522 total). Vue/server TypeScript and Vite production build pass; the existing chunk advisory is 609.26 kB. Full-stack PostgreSQL/Compose and browser match acceptance remain unverified.

- The real catalog `100 правил драгонболла` is now supported with its full score-triggered extra draw and private optional discard (up to three or keep-all), rather than only a synthetic one-line draw description. Score evaluation uses the pre-draw hand and stored adjustment. `Сдача трупа` now resolves its heal-and-draw effect once on cast or an actual burn from start-turn choices, Conveyor, or Librarian; a burn save suppresses it. The lobby shares these parsers and also enables the existing `Геймнайт` command.
- Latest verification after these changes: contracts 13/13, game-core 146/146, server 111/111, local effects 241/241, online snapshot 1/1, local combat 2/2 (514 total). Vue/server TypeScript checks and Vite production build pass with the existing chunk advisory (607.50 kB). Tests for the new spells use their full real catalog descriptions.

- Server dependencies are pinned and recorded in the workspace lockfile; native `argon2` installation was permitted and completed.
- Docker CLI/Compose are installed, but the Docker Engine is unavailable. A host PostgreSQL 18 service is listening on port 5432, but the required project credentials are not configured; `psql` is not installed. Compose syntax was checked; images were not built and the SQL migration/role bootstrap have not been exercised against a project database.
- The authoritative command protocol currently supports concession, turn ending with a simple start-turn effect subset including numeric card draws, single forward movement, private hand-card burns, and the `Генератор щита` target choice, basic creature/building placement with simple entry effects, an entry heal choice, targeted creature-heal, Пудж move-front, Абрамс free-cell movement, Тонатий swap, Игла's three-target damage/heal choices, and the Рокировочка two-creature spell choice, Hoppy flipped-card entry choice, Lazerwygs34 round-ten entry buff, and Обсидиан пчёла self-destruction ability; Doggo stat buffs and Turret range-entry damage apply on ordinary and supported ability/spell/start-turn movement. Ordinary unit attacks have simple player-heal/player-damage death triggers and cataloged resource/draw/healing/player-damage crown effects, plus simple unit/player damage, destroy-attacker, and take-control-attacker traps. Direct attacks on players support the cataloged crown effects; passive item effects reuse current rules helpers, online ability effects including Dupe score adjustment, Noovse movement lock, Лусио temporary health, Айсберг draw-or-limit choice, Биби building sacrifice, Фанат геншина gamba, Генератор потех draw, and Тау-пушка attack threshold, plus the staged Конвейерное производство ability and simple healing/direct-damage spells including Брэпси, Новый видос, Геймнайт, Бан, and Миндальная вода, full allied-board healing, eight selected-target damage spells, targeted creature flip, global creature flip, global creature burn, Гастер Бластер line damage, Лазанья line buffs, global creature damage, selected-building destruction, selected-card discard/return, Рейджбайт, 5000 участников, Ледяной шок, Знаком по ебалу, Х-Слеш, X-Слеш, and one 3×3 area-damage spell are available. Most other spells, movement triggers, transfer-item and choice traps, most items with entry/crown/trap/ability/gamba/death/movement/start-turn effects, most targeted/choice abilities and entry choices, many card-specific combat/death effects, and complex turn-start/entry effects remain unavailable. Local rules are still partly in `App.vue`, so online parties cannot yet be played through a full game. Accepted commands preserve state/receipt/version transactionality through the existing command pipeline.
- The detailed Obsidian folder is outside the workspace write roots. Keep this in-repo status current; external-note edits require filesystem authorization if needed.
- The Actions workflow cannot be executed until this local repository is pushed to GitHub. Automated VPS deploy, backup/restore automation, production VPS/domain/credentials and physical second-device checks remain outstanding.

- The cataloged death effect of `Ваня Веремеев` now buffs living allied creature cards in all eight neighboring cells through the shared online death resolver and the same stat helpers as local play. `Маринует мясо` repeats the effect using the shared death-pass rule. Tests cover flipped, dying, enemy, building, and distant exclusions; the server retry test confirms the buff is committed once.
- Latest verification: contracts 15/15, game-core 184/184, server 122/122, local effects 241/241, online snapshot 1/1, local combat 2/2 (565 total). Vue/server TypeScript and Vite production build pass; existing JS chunk advisory is 610.12 kB. `pnpm` registry access was unavailable, so checks used existing local binaries. Full-stack PostgreSQL/Compose and two-browser match acceptance remain unverified. No Git upload.

- `Подстава` is now supported by the authoritative online spell resolver. After normal payment it moves from the caster's hand to the opponent's discard pile. Local and online rules use one strict shared description parser; the server retry test confirms one payment and one transfer.
- Latest verification: contracts 15/15, game-core 185/185, server 123/123, local effects 242/242, online snapshot 1/1, local combat 2/2 (568 total). Vue/server TypeScript checks and Vite production build pass; JS chunk advisory is 610.23 kB. Full-stack PostgreSQL/Compose and two-browser match acceptance remain unverified. No Git upload.

- `1 апреля` now resolves online through the authoritative spell command. It privately chooses two living creatures (including flipped creatures) and exchanges combat stats, energy reduction, tracked stat buffs, black tokens, and type-token arrays without moving units. Local play uses the shared description parser and swap helper; retry coverage confirms exactly-once resolution.
- Latest verification: contracts 15/15, game-core 186/186, server 124/124, local effects 243/243, online snapshot 1/1, local combat 2/2 (571 total). Vue/server TypeScript and Vite production build pass; JS chunk advisory is 610.88 kB. Full-stack PostgreSQL/Compose and two-browser match acceptance remain unverified. No Git upload.

- `Посмотрюка я Стивен ДНД` is now enabled in both local and online deck building. Its shared strict parser recognizes the stun effect and burn suffix; the online core validates a living creature target, stacks 10 stun, and burns the spell. Local play uses the same parser and burn finalizer. Its development tag and audit entry were removed.
- Latest verification: contracts 15/15, game-core 187/187, server 125/125, local effects 245/245, online snapshot 1/1, local combat 2/2 (575 total). Vue/server TypeScript and Vite production build pass; JS chunk advisory is 611.30 kB. Full-stack PostgreSQL/Compose and two-browser match acceptance remain unverified. No Git upload.

- `Белая дверь` and `Брутфорс` now use a shared description parser and an owner-private cell choice. White Door moves an active creature or interior-row building to any empty legal socket; Bruteforce moves an active creature only to an empty socket on the opponent home row. Server validation repeats the target and destination restrictions, and the lobby exposes the legal cells. `В следующий раз повезёт` now rolls on the server and applies the result to a creature, building, or either player; the self-player target is represented in the runtime protocol. Receipt-backed retries do not reroll. A stale death-chain assertion now measures the hand-size delta against the match opening hand.
- Latest verification: contracts 15/15, game-core 192/193, server 130/130, local effects 248/248, online snapshot 1/1, local combat 2/2 (588 passing, 1 failing). Vue/server TypeScript and Vite production build pass; JS chunk advisory is 613.93 kB. The broad catalog smoke test now stops at `Дискорд драма`, whose variable-mana score-gated target selection remains unsupported online. Full-stack PostgreSQL/Compose and two-browser match acceptance remain unverified. No Git upload.
# Latest continuation (2026-10-15)

- Read the attached goal objective before continuing. The catalog smoke test no longer stops at `Дискорд драма`; Discord Drama, Dodep, and Rose Evil now use the authoritative online spell path, including server-validated variable mana/health, private choices, and retry-safe resolution. The Dodep no-hand path is covered without rolling.
- Latest verification: contracts 18/18, game-core 198/198, server 133/133, local effects 248/248, online snapshot 1/1, and local combat 2/2 (600 total). `vue-tsc --build` and `vite build` pass; the existing JS chunk advisory is 617.40 kB. `pnpm` scripts could not run because registry access returned EACCES, so tests and build used the installed local binaries directly.
- Remaining acceptance work includes exercising the real PostgreSQL/Compose stack and the complete match flow in two independent browser contexts. Production deployment still needs GitHub/VPS/domain credentials and a configured host. No upload or push was performed.

# Latest continuation (2026-10-15, end-of-turn effects)

- The authoritative `turn.end` path now resolves catalog effects from `Аква` and `Бункерный паук` in board order. Aqua's damage scales with its class-three tokens, then it gains a token; lethal damage ends the match before later turn processing. Bunker Spider reduces speed for adjacent active creatures of either owner and leaves buildings, flipped, dying, and distant cards unchanged. Added three focused core tests.
- Latest verification: contracts 18/18, game-core 201/201, server 133/133, local effects 248/248, online snapshot 1/1, local combat 2/2 (603 total). Vue and server TypeScript checks and Vite production build pass; the existing JS chunk advisory is 617.40 kB. Production and development Compose configurations parse using `.env.example`; Docker Engine remains unavailable in this environment, so PostgreSQL integration and two-browser acceptance remain unverified.
- Corrected the README's stale deployment and game-coverage summary. The existing CI workflow builds and publishes SHA-addressable GHCR images; automated VPS deployment, backup/restore drills, full local game-rule parity, and two-browser acceptance are still outstanding. No Git upload or push.


# Latest continuation (2026-10-15, Depressive Jaw)

- Online `Депрессивная Жопа` now uses the shared whole-hand discard parser, fixes its owner hand limit at one, takes the top discard card at the start of its owner's turn, and restores the saved limit when the last copy leaves the board. Other limit changes are ignored while locked; the private snapshot reports the lock only to its owner, and the online turn UI disables the increase-limit action.
- Added core and catalog-focused tests, including opponent privacy. Verification: contracts 18/18, game-core 205/205, server 133/133, local effects plus snapshot/combat 252/252 (608 total). `vue-tsc --build`, server TypeScript, and `vite build` pass; bundle advisory is 617.59 kB. Production/development Compose configurations parse with `.env.example` (Docker emits a permissions warning for its user config).
- Real PostgreSQL/Compose startup and two-browser acceptance remain unverified because Docker Engine is unavailable. VPS/domain/deployment credentials are still needed for production. No push.

# Latest continuation (2026-10-15, Вкидгранник)

- Online crown resolution now supports `Вкидгранник`: after either a card attack or direct player attack, it returns the attacking creature to its owner's hand and discards its equipped item. Returned attackers are removed from the pending death-resolution list. The shared rules-based parser checks the catalog wording.
- Core tests cover board and player attacks; a receipt-backed server test covers exactly-once return and verifies the opponent snapshot does not reveal the returned card. Verification: contracts 18/18, game-core 207/207, server 134/134, local effects plus snapshot/combat 252/252 (611 total). Vue/server TypeScript and Vite build pass; the existing 617.59 kB chunk advisory remains.
- Docker Engine is still unavailable, so Compose syntax is not evidence of a running PostgreSQL stack. Two-browser acceptance, full shared local/online rules, and production setup remain outstanding. No push.

- Edge-case follow-up: verified `Вкидгранник` returns to hand even when its counterattack would otherwise kill it. Final counts for this turn: contracts 18/18, game-core 208/208, server 134/134, local effects/snapshot/combat 252/252 (612 total). No new full-stack or browser runtime verification was possible; Docker Engine is absent.

# Latest continuation (2026-10-15, Rocking Knight)

- `Рокочущий рыцарь` now resolves its crown effect online: after combat, it destroys the attacked creature only when its current health is below maximum. The existing death resolver applies its burn-on-kill rule and other supported death effects. A shield that absorbs the attack and leaves the creature at full health prevents the crown destruction.
- Tests cover damaged and shield-protected targets plus transactional exactly-once burn on retry. Verification: contracts 18/18, game-core 210/210, server 135/135, local effects/snapshot/combat 252/252 (615 total). Vue/server TypeScript and Vite production build pass; the existing 617.59 kB bundle advisory remains.
- Local PostgreSQL port is listening but project credentials are absent and the read-only connection attempt failed; migrations and live DB acceptance remain unverified. Docker Engine is unavailable. No push.

# Latest continuation (2026-10-15, Magician Red)

- `Magician Red` crown damage is now enabled in authoritative combat. It deals one additional point to the creature or building just attacked, after ordinary combat damage, using the shared damage/death resolver. This preserves shield behavior and runs supported death effects if the extra point is lethal; direct player attacks do not invent a card target.
- Core coverage verifies that a shield absorbs the combat hit but not a separate crown point, and that the crown point can finish a death-trigger chain. A receipt-backed server test confirms the damage and death effect commit once. Verification: contracts 18/18, game-core 212/212, server 136/136, local effects/snapshot/combat 252/252 (618 total). Vue/server TypeScript and Vite production build pass; the existing 617.59 kB chunk advisory remains.
- PostgreSQL integration still cannot run: local port accepts connections, but no project credentials/configuration are present. Docker Engine remains unavailable. No push.

# Latest continuation (2026-10-15, Bazooka)

- `Базука` now resolves its crown splash around the attacked board card in online combat: one point to every living, face-up creature in the eight neighboring sockets, including allies and the attacking creature if adjacent. It excludes the primary target, buildings and flipped creatures. Every hit uses the normal shield, damage and death resolver.
- Core tests cover both sides, diagonal neighbors, source/target exclusions, buildings, flipped and distant creatures, plus a lethal adjacent death-draw. A transactional retry test confirms the death chain occurs once. Verification: contracts 18/18, game-core 213/213, server 137/137, local effects/snapshot/combat 252/252 (620 total). Vue/server TypeScript and Vite production build pass; existing bundle advisory remains 617.59 kB.
- PostgreSQL/Compose runtime and two-browser acceptance remain unverified due missing project DB credentials and unavailable Docker Engine. No push.

# Latest continuation (2026-10-15, Degra)

- `Дегра` crown now flips its attacker for the cataloged two turns and resolves that card's shared flip trigger immediately (stat changes, draw and mana). The combat pipeline keeps crown-before-trap order, so a lethal trap cannot damage the newly flipped attacker. Direct player attacks accept the effect without inventing a board target.
- Tests cover `.Хихо` flip rewards before a lethal trap and a receipt-backed retry proving the flip, draw and mana resolve once. Verification: contracts 18/18, game-core 214/214, server 138/138, local effects/snapshot/combat 252/252 (622 total). Vue/server TypeScript and Vite production build pass; the existing 617.59 kB bundle advisory remains.
- Full PostgreSQL/Compose and two-browser acceptance remain unverified; no project DB credentials and no Docker Engine. No push.

# Latest continuation (2026-10-15, Pickaxe)

- `Кирка ФСШ` now resolves its crown online: attacks may target a friendly card safely without normal combat damage; the crown removes the attacked creature's item and reverses its stat/equip bonuses, or destroys an attacked building through the regular death resolver. Removed items go to their owner's discard.
- Core tests cover friendly item removal with stat restoration and building destruction. A receipt-backed server test confirms item removal and stat restoration happen once. Verification: contracts 18/18, game-core 216/216, server 139/139, local effects/snapshot/combat 252/252 (625 total). Vue/server TypeScript and Vite production build pass; existing 617.59 kB chunk advisory remains.
- PostgreSQL/Compose runtime and two-browser acceptance remain unverified because project credentials and Docker Engine are unavailable. No push.

# Latest continuation (2026-10-15, Собирающий жук)

- Corrected the cataloged behavior: the beetle takes an item from a chosen creature on entry, while its trap transfers its item to the attacker and grants +3 attack only when the transfer succeeds. Both paths now run in game-core; local entry targeting uses the same parsed operation.
- Entry item selection is owner-private and transactional. Transfer removes donor stat/equipment modifiers, applies them to the beetle, and keeps item ownership on the board. Duplicate choice and attack commands do not repeat their mutations.
- Verification: 629/629 contracts, core, server, local effect, snapshot, and local combat tests pass; Vue and server TypeScript checks pass; Vite production build passes with the existing 617.99 kB bundle advisory. Full PostgreSQL/Compose startup and two-browser acceptance are still unverified. No push.

# Latest continuation (2026-10-15, Hameleonew)

- Hameleonew now saves one subsequent burned card for its owner through the `nextBurnToSave` state. The description is checked exactly, the private snapshot exposes only the viewing player's count, and command receipts make repeated card-play requests idempotent.
- Verification: contracts, game-core, server, local effects, online snapshots, and local combat pass 631/631; Vue/server TypeScript and Vite production build pass. The existing large-bundle advisory remains. PostgreSQL/Compose runtime and two-browser acceptance are still unverified; no push.

# Latest continuation (2026-10-15, Бёрдли)

- `Бёрдли` now grants its owner +2 on their next gamba from its entry effect. The exact catalog description is checked, the bonus is consumed by existing shared gamba resolvers, and snapshots/UI show the pending bonus only to its owner.
- A server receipt test verifies a duplicate play does not stack the bonus; core coverage verifies the owner-only projection. Verification: 633/633 combined tests pass, Vue/server TypeScript checks pass, and the Vite build passes with a 618.27 kB bundle warning. PostgreSQL/Compose and two-browser acceptance remain unverified; no push.

# Latest continuation (2026-10-15, Вондертян)

- `Вондертян` now draws its owner to eight cards and sets the hand limit to eight through the end of that owner's next turn. Limit changes during the override update its saved base; overlapping temporary changes and expiration restore the correct remaining limit. The exact catalog description is validated.
- Core coverage exercises the full turn lifecycle and overlap with `Геймнайт`; server receipt coverage confirms duplicate play does not repeat the draw or override. Verification: 636/636 combined tests pass; Vue/server TypeScript and Vite production build pass. The JS bundle advisory remains (618.27 kB). PostgreSQL/Compose and two-browser acceptance remain unverified; no push.

## Latest continuation (2026-10-15, Индиголит)

- Online `Индиголит` now resolves its exact entry as five separate 1-point healing choices. Its owner can repeat targets and heal either player or any living non-flipped creature/building. The owner-only projection supplies the remaining count, both player targets, and eligible board targets; the client can submit each choice independently.
- Core tests cover repeated target picks, both players, and owner privacy. The server receipt test proves retrying a choice does not heal twice. Verification: 640/640 combined tests, Vue/server TypeScript checks, and Vite production build pass; the existing >500 kB bundle advisory remains. Docker Engine is unavailable here; full Compose/PostgreSQL and two-browser acceptance remain unverified. No push.

## Latest continuation (2026-10-15, Исчезающий парень)

- Online entry now resolves the server-side gamba for `Исчезающий парень`: adjusted rolls 1–4 cause normal death/discard handling, and 5–6 leave it alive. The exact catalog text is checked; the roll consumes the player's pending gamba bonus.
- Core boundary tests cover 1, 4, 5, and 6; the server receipt test confirms retrying play does not re-roll or repeat death. Verification: 642/642 combined tests, Vue/server TypeScript, and Vite production build pass. The existing large-bundle advisory remains. Docker Engine is unavailable, so the full PostgreSQL/Compose runtime and two-browser acceptance remain unverified. No push.

## Latest continuation (2026-10-15, Исчезающий парень)

- Online entry now resolves the server-side gamba for `Исчезающий парень`: adjusted rolls 1–4 cause normal death/discard handling, and 5–6 leave it alive. The exact catalog text is checked; the roll consumes the player's pending gamba bonus.
- Core boundary tests cover 1, 4, 5, and 6; the server receipt test confirms retrying play does not re-roll or repeat death. Verification: 642/642 combined tests, Vue/server TypeScript, and Vite production build pass. The existing large-bundle advisory remains. Docker Engine is unavailable, so the full PostgreSQL/Compose runtime and two-browser acceptance remain unverified. No push.

## Latest continuation (2026-10-15, Декстергон)

- Online `Декстергон` now accepts the optional Horny 6 choice. The server validates the exact catalog text, applies six health loss once, and shields living creatures in the sockets immediately to its left and right. The online hand UI exposes the choice before placement.
- Tests cover both opted-in and normal placement, horizontal-only shielding, runtime contract validation, and server retry idempotency. Verification: 644/644 combined tests, Vue/server TypeScript, and Vite production build pass. Existing bundle-size advisory remains; real PostgreSQL/Compose startup and two-browser acceptance are still unverified because Docker Engine is unavailable. No push.

# Latest continuation (2026-10-15, Висмут Шифера)

- Online entry and death now search the owner's deck for one item and one building, shuffle the remaining deck, and let the owner discard either found card. The private choice exposes only those two hand cards; queued choices are promoted after the current choice resolves.
- Core coverage verifies entry, death, private options, and both resolution outcomes. A server receipt test confirms a repeated choice command discards exactly once. Verification: 646/646 combined tests pass; Vue and server TypeScript checks pass; Vite production build passes with the existing 620.56 kB bundle advisory. Docker Engine is unavailable, so full PostgreSQL/Compose startup and two-browser acceptance remain unverified. No push.

# Latest continuation (2026-10-15, Совунья)

- `Совунья` now resolves its entry as an owner-private choice of a living, unflipped creature or building, healing the selected board card by two. Existing full-heal entry behavior remains intact; shared choice resolution applies the usual healing triggers.
- Core tests cover eligible targets, opponent privacy, and the exact health change. A transactional server test confirms retrying the choice heals once. Verification: 648/648 combined tests; Vue/server TypeScript; Vite production build passes with the existing 621.01 kB bundle advisory. Docker Engine, PostgreSQL/Compose runtime, and two-browser acceptance remain unverified. No push.

# Latest continuation (2026-10-15, приватность событий выбора)

- Убрал id выбранной карты из руки из широковещательного `choice.resolved` события Висмута. Оба игрока получают один список событий; до исправления соперник мог увидеть instance id карты из скрытой руки. Регрессионная серверная проверка подтверждает, что id не попадает в события и повтор выбора всё ещё идемпотентен.
- Проверка: 648/648 объединённых тестов; TypeScript клиента и сервера. Vite production-сборка проходит; предупреждение о JS-бандле 621.01 кБ остаётся. Полный PostgreSQL/Compose и двухбраузерный сценарий всё ещё требуют Docker Engine.

# Latest continuation (2026-10-15, Салюбра)

- «Салюбра» now heals each damaged allied creature by three on entry, grants the printed energy for each creature actually healed, and applies existing Pink Diamond/Ame healing triggers. Her catalog entry is no longer tagged `в разработке`, so deck validation and the public catalog now allow her.
- Regression coverage verifies healthy/enemy/flipped creatures are skipped, healing triggers fire, and a retried server command applies the effect once. Updated the mechanics audit and the API catalog-count assertion. Verification: 650/650 combined tests, Vue/server TypeScript, and Vite production build pass (621.29 kB JS chunk advisory remains). Docker/PostgreSQL and two-browser acceptance remain unverified. No push.

# Latest continuation (2026-10-15, Гном)

- Онлайн-розыгрыш «Гнома» применяет соседние входные баффы: существу слева +2 здоровья и максимального здоровья, существу справа +2 атаки. Используется общий `entryNeighborBuffs`; повтор команды не применяет эффект повторно.
- Core и серверные проверки покрывают обе стороны эффекта и повтор команды. Проверка: 662/662 объединённых теста, Vue/server TypeScript и Vite production-сборка проходят. JS chunk 621.88 кБ остаётся выше advisory 500 кБ. Docker Engine недоступен, поэтому полный Compose/PostgreSQL runtime и двухбраузерный сценарий остаются непроверенными. No push.

# Latest continuation (2026-10-15, Турбот)

- «Турбот» online clears flip from all flipped creatures on entry. A creature at zero health is resolved through normal death handling; buildings are untouched. The server checks the exact catalog text and transactional retries apply the effect once.
- Core test verifies both players' creatures, zero-health death, and building exclusion; server test verifies receipt deduplication. Targeted tests pass. Full suite and production checks pending in this continuation. No push.

# Latest continuation (2026-10-15, Жёлтый алмаз и проверка)

- «Жёлтый алмаз» разворачивает входной эффект онлайн: переворачивает каждую другую карту на поле, включая здания, и выполняет поддерживаемые триггеры переворота владельца карты. Карта проверяется по точному каталожному описанию.
- Core и серверные тесты подтверждают эффект на обеих сторонах, здания, исключение самого «Жёлтого алмаза» и идемпотентность повтора.
- Общая проверка: 666/666 тестов; `vue-tsc --build`; `tsc -p apps/server/tsconfig.json --noEmit`; `vite build`; Compose config validation — проходят. В production-сборке сохраняется advisory на JS chunk 621.88 кБ. Docker Engine не запущен, поэтому Compose/PostgreSQL runtime и два браузерных контекста не проверены. No push.

# Latest continuation (2026-10-15, Айболл)

- «Айболл» разыгрывается онлайн и открывает владельцу приватный выбор любого живого здания на поле. Выбранное здание проходит обычную обработку смерти и отправляется в сброс владельца; если зданий нет, розыгрыш всё равно завершается без выбора.
- Core проверяет список целей, приватность выбора и сохранность остальных карт. Серверный тест проверяет snapshot соперника и идемпотентный повтор выбора. Проверка: 668/668 тестов, Vue/server TypeScript и Vite production-сборка проходят; JS chunk advisory 621.88 кБ остаётся. Docker Engine недоступен, поэтому полный Compose/PostgreSQL runtime и приёмочный сценарий в двух браузерах не выполнены. No push.

# Latest continuation (2026-10-15, Аси.mp4)

- «Аси.mp4» теперь открывает приватный выбор существа, полностью лечит выбранную цель и переворачивает её на два хода. Переворот проходит через штатный триггерный обработчик, включая .Хихо (его бонус к характеристикам, добор и мана).
- Core и transactional server tests проверяют приватность, лечение, flip-trigger, commit и однократность эффекта при retry. Проверка: 670/670 тестов, Vue/server TypeScript и Vite production build проходят. JS chunk advisory 621.88 кБ остаётся; Docker Engine отсутствует, поэтому полный Compose/PostgreSQL runtime и тест в двух браузерах ещё не выполнены. No push.

# Latest continuation (2026-10-15, эффекты оглушения при входе)

- «Мендор», «Тюшма» и «Ральзей» теперь открывают владельцу приватный выбор допустимого существа для оглушения на указанный срок. У «Тюшмы» выбор появляется только после сожжения карты в этом ходу; «Ральзей» сразу восстанавливает владельцу 4 здоровья. Core и server tests покрывают фильтрацию целей, условие, лечение и повтор команды.
- Проверка: 673/673 теста; `vue-tsc --build`, серверный TypeScript и Vite production build проходят. JS chunk 622.08 кБ превышает advisory 500 кБ. Полный PostgreSQL/Compose и проверка двух браузерных контекстов требуют Docker Engine и всё ещё не выполнены. No push.

# Latest continuation (2026-10-15, синхронизация типов онлайн-снимка)

- Онлайн-клиентский тип `pendingChoice.kind` синхронизирован с состояниями, которые реально создаёт game-core. До этого snapshot включал 15 неперечисленных видов выбора и его TypeScript-контракт не описывал ответы движка.
- Проверка после исправления: `vue-tsc --build` и 673/673 объединённых теста проходят. Vite production-сборка остаётся зелёной (предыдущий результат: JS chunk 622.08 кБ). Локальный PostgreSQL работает. Compose приёмку всё ещё не удалось начать: Docker Desktop Service остановлена; попытка запустить службу получила `Cannot open ... service`, запуск приложения также не поднял engine pipe.

# Latest continuation (2026-10-15, общий тип состояний выбора)

- Убрал повтор списка `pendingChoice.kind` из онлайн-компонента: теперь он использует `PendingChoiceKind`, выведенный из фактического union в game-core. Новые состояния выбора больше не требуют вручную синхронизировать длинный список в UI.
- Проверки после изменения: `vue-tsc --build`, серверный TypeScript и 366 целевых core/server match-тестов проходят. Полный набор из 673 тестов прошёл в предыдущей итерации; Vite build не перезапускал, поскольку изменились только типы.

# Latest continuation (2026-10-15, регистрация и username)

- Добавил регрессионную проверку гонки двух регистраций одного нормализованного логина: имитация уникального DB constraint гарантирует результат 201 + 409, без дублирования аккаунта. Также проверяется, что PATCH профиля отклоняет попытку заменить неизменяемый username.
- Проверки: полный объединённый набор 674/674; `vue-tsc --build`; серверный `tsc --noEmit`; Vite production build — проходят. JS chunk 622.08 кБ остаётся выше предупреждения 500 кБ. Compose runtime и два браузера всё ещё недоступны из-за остановленной Docker Desktop Service.

# Latest continuation (2026-10-15, rate limit входа)

- Добавил тест API на лимит неудачных входов: пять попыток с разными вариантами регистра/пробелов одного username нормализуются в один ключ, шестая возвращает 429 `RATE_LIMITED`.
- Проверки: 675/675 тестов, клиентский и серверный TypeScript, Vite production build проходят. Проверка локального PostgreSQL без credentials невозможна (SCRAM требует пароль); Docker Desktop Service по-прежнему недоступна, поэтому full-stack и два браузера не проверены.

# Latest continuation (2026-10-15, явный выход создателя)

- Добавил регрессионное покрытие lifecycle-команды выхода создателя: комната исчезает немедленно, обе записи участников очищаются, код больше нельзя использовать для повторного входа. Код RoomManager уже выполнял это правило.
- Проверки: 676/676 объединённых тестов; `vue-tsc --build`; server `tsc --noEmit`; Vite production build проходят. JS chunk 622.08 кБ выше advisory 500 кБ. Runtime full-stack и два браузера пока не проверены.

# Latest continuation (2026-10-15, reconnect активного матча)

- Добавил проверку reconnect для уже идущей партии: гость возвращается до 60-секундного дедлайна, создатель — до 15-секундного; комната остаётся `playing`, а оба видят тот же `matchId`.
- Полные проверки: 677/677 тестов; `vue-tsc --build`; server `tsc --noEmit`; Vite production build проходят. Проверка не запускает реальные сетевые соединения; двухбраузерный runtime по-прежнему ждёт доступного Docker/PostgreSQL.

# Latest continuation (2026-10-15, завершение reconnect-окон в активной партии)

- Проверил истечение reconnect deadline во время активного матча: timeout гостя выдаёт lifecycle event с matchId, освобождает его место и возвращает владельца в лобби с тем же кодом; timeout создателя выдаёт event с matchId и удаляет комнату, повторное соединение не восстанавливает матч.
- Полные проверки: 679/679 тестов; TypeScript клиента и сервера; Vite production build проходят. Тесты подтверждают переходы RoomManager; DB update lifecycle event и двухбраузерный сценарий требуют runtime-проверки.

# Latest continuation (2026-10-15, поздний reconnect)

- Исправил late reconnect после дедлайна: сервер теперь удаляет просроченную комнату и активный матч, сохраняет lifecycle event для DB abort, но подтверждает новое WebSocket-соединение как обычную онлайн-сессию без возврата в комнату. Ранее `RoomManager.connect` выбрасывал `RECONNECT_EXPIRED`, оставляя живой сокет без `session.hello.ack`; пользователь зависал офлайн до обновления страницы.
- Регрессионный тест проверяет сохранение lifecycle event с прежним matchId, отсутствие старой комнаты/матча и возможность создать новую комнату в свежей сессии. Проверки: 679/679 тестов, Vue и server TypeScript, Vite production build проходят.

# Latest continuation (2026-10-15, разрешённые предметы в онлайне)

- Read-only прогон каталога обнаружил 11 карт-предметов без тега `в разработке`, которые `equipItem` отклонял общей защитой `UNSUPPORTED_EFFECT`, несмотря на существующие обработчики их атак, способностей и триггеров. Добавил эти поддерживаемые предметы в список исключений защиты и регрессионный тест, который пытается экипировать каждый разрешённый предмет через game-core.
- Проверки: 680/680 тестов; `vue-tsc --build`; server `tsc --noEmit`; Vite production build проходят. Это подтверждает экипировку каталожных предметов; двухбраузерный full-stack сценарий всё ещё не проверен.

# Latest continuation (2026-10-15, атакующие предметы)

- Сетевой движок теперь разрешает «Пилюлю» и выполняет её гамба-лечение/урон по атакованному существу; добавлен тест обоих исходов с внедрённым броском. «Банхаммер» теперь сжигает атакованное существо и существо-носителя, с проверкой обеих сожжённых карт.
- Проверки: 246 тестов game-core проходят; смешанный прогон game-core + card-effects — 495/495 до последнего уточнения теста Банхаммера. Точечная проверка актуального кода после уточнения Банхаммера также проходит.
- Остаются сетевые эффекты перемещения цели от «Грави пушки» и «Тулгана», а также выбор награды «Загребущего роя» при смерти существа; full-stack проверка по-прежнему зависит от доступности Docker/PostgreSQL.

# Latest continuation (2026-10-15, crown movement choices)

- «Грави пушка» теперь открывает выбор свободной соседней клетки для перемещения пережившей бой цели; «Тулган» — любой доступной свободной клетки для атакованного существа. Выбор передаётся отдельной командой и повторно проверяется сервером. OnlineLobby показывает клетки как явные кнопки.
- Проверки: 683/683 тестов по игровому ядру, карточным эффектам, контрактам, серверу и online snapshot; `vue-tsc --build`, server `tsc --noEmit` и Vite production build проходят. Chunk 622.64 кБ превышает advisory 500 кБ.
- Непокрыто: выбор награды «Загребущего роя», полный запуск Compose/PostgreSQL и независимый двухбраузерный матч. Docker daemon сейчас недоступен.

# Latest continuation (2026-10-15, Загребущий рой)

- Реализован приватный выбор награды после гибели существа-владельца на его ходу; при нескольких источниках «Загребущего роя» выборы ставятся в очередь. «Мана» выдаётся сразу, «карта» доступна только при непустой колоде. Удалены прежние блокировки `UNSUPPORTED_EFFECT` для этих смертей, включая смерть Догго при завершении хода. Добавлены серверная валидация и две кнопки выбора в OnlineLobby.
- Полный локальный набор: 686/686 тестов game-core, contracts, server и клиентских игровых модулей; `vue-tsc --build`; server `tsc --noEmit`; Vite production build — успешны. Bundle 622.32 кБ остаётся выше предупреждения 500 кБ.
- Не подтверждён runtime двумя браузерами: рабочая PostgreSQL служба отвечает, но локальное подключение роли `postgres` требует пароль; Compose daemon недоступен. Попытка поднять одноразовый кластер PostgreSQL изолированно в sandbox остановилась на Windows restricted-token/правах каталога, не затронув установленный сервис.

# Latest continuation (2026-10-15, повторная проверка окружения)

- Повторный прямой прогон через Node подтвердил 686/686 тестов: game-core 250, server 166, contracts 18, клиентские игровые модули 252. `vite build` отдельно завершился успешно (chunk 622.32 кБ).
- Обычный запуск `pnpm` через Corepack сначала не прошёл из-за недоступной сети. Затем `corepack pnpm@11.25.0 install --frozen-lockfile` успешно восстановил `node_modules` (240 пакетов, lockfile не менялся). После переустановки `vue-tsc --build` и server `tsc` всё ещё не проходят: TypeScript не следует Windows junction до зависимостей Vue и соседнего каталога `reference/cards.json` (`apps/server/node_modules/@bfw/game-data/src/index.ts`). Код приложения по этому сигналу не менялся; требуется исправить или обойти несовместимость type resolution в текущем Windows toolchain.
- Попытка поднять временный PostgreSQL повторно завершилась `Permission denied` на bind 127.0.0.1:55432; API не поднят. Полный сценарий комнаты/матча двумя независимыми браузерными контекстами остаётся непроверенным. Временные правила proxy для браузерной проверки удалены из `vite.config.ts`.

# Latest continuation (2026-10-15, Глойньки)

- Онлайн «Глойньки» больше не блокирует розыгрыш карт: применяет +1 к атаке, здоровью и максимуму здоровья за каждую карту своего владельца, включая самих «Глойньки». Эффекты заклинаний и экипировки применяются в момент розыгрыша до их последующего разрешения. Бонусы снимаются в конце хода владельца; смертельное снижение здоровья использует обычное разрешение смерти.
- Также включён уже описанный локально эффект «Жемчуга Санеса»: постоянное +1 к здоровью за разыгранный владельцем предмет или заклинание.
- Тест game-core покрывает самобаф, повторный триггер от здания, окончание временных бонусов и сохранение отдельного отказа для неразрешённого выбора «Внешнего рая». Объединённый прогон: 687/687 тестов. `npm run build`: Vite production build успешен (JS chunk 622.32 кБ, advisory свыше 500 кБ), но общая команда завершается ошибкой `vue-tsc`: TypeScript не видит экспорты Vue через Windows junction, та же проблема окружения, отмеченная выше. Compose/PostgreSQL runtime и двухбраузерная приёмка ещё не подтверждены. No push.

# Latest continuation (2026-10-15, Внешний рай)

- Онлайн «Внешний рай» теперь реагирует на розыгрыш вражеского существа: владелец карты получает приватный выбор своего живого существа, которому уменьшается стоимость движения на 1. Если сработало несколько источников, выборы обрабатываются по очереди; цель, владелец и право отвечать проверяются сервером. Публичный snapshot передаёт снижение стоимости движения, секретных данных выбор не содержит.
- Проверка покрывает две карты «Внешний рай», приватность выбора, ответ владельца вне своего хода, запрет ответа другим игроком, отклонение чужой цели, расчёт нулевой стоимости движения и продвижение очереди. Объединённый набор: 687/687; `npm run build-only` проходит. `npm run type-check` остаётся красным из-за известных ошибок Vue exports/junction с каскадными implicit-any ошибками; ошибок game-core в текущем выводе нет. Compose/PostgreSQL runtime и двухбраузерная приёмка по-прежнему не подтверждены. No push.

# Latest continuation (2026-10-15, Windows TypeScript resolution)

- Устранил ошибку Vue typecheck: pnpm теперь публично поднимает только `@vue/*` через `publicHoistPattern`, чтобы `vue-tsc` разрешал декларации из pnpm junctions. Серверный tsconfig направляет компилятор к реальным исходникам `@bfw/*` workspace-пакетов и использует корень монорепозитория как `rootDir`; runtime импорты не менялись.
- Проверка установки: `corepack pnpm@11.25.0 install --frozen-lockfile` прошёл, повторно использовал 240 пакетов, lockfile не менялся. `npm run build` проходит полностью, `npm --prefix apps/server run build` проходит, объединённый набор — 687/687. Vite оставляет advisory о JS chunk 622.32 кБ.
- Полный runtime по-прежнему не проверен: Docker CLI не находит `dockerDesktopLinuxEngine` pipe. Поэтому Compose/PostgreSQL и матч в двух независимых браузерах остаются открытыми; CI/CD deploy, backup/restore и production credentials тоже требуют отдельной приёмки. No push.

# Latest continuation (2026-10-15, backup role and restore drill helpers)

- Added a least-privilege `bfw_backup` database role with read access to current and future tables/sequences, plus a distinct `BACKUP_DB_PASSWORD` setting.
- Added `scripts/backup-db.sh` to emit a private custom-format dump, validate its archive catalog, and publish it atomically; added `scripts/verify-backup-restore.sh` to restore into a uniquely named temporary database, verify the initial migration, compare account/avatar/deck row counts with the source, then remove the temporary database. README documents invocation and off-host copy requirement.
- CI now runs `bash -n` over both operation scripts and the PostgreSQL role initializer.
- `docker compose -f compose.yml -f compose.dev.yml config --quiet` passes with validation-only values. Shell syntax checks could not run: Git Bash failed to create its restricted runtime object and WSL returned `Wsl/E_ACCESSDENIED`; Docker daemon is also unavailable, so role initialization, dump creation, and restore drill remain unverified. No Git upload.

# Latest continuation (2026-10-15, PostgreSQL migration CI)

- CI verification now provisions an ephemeral PostgreSQL 18 service. A new integration test applies migrations twice to its empty public schema, then checks the exact migration record and required application tables. CI also runs the production migrate/catalog-seed command twice, covering the deployed entry point and idempotent seeding.
- `npm --prefix apps/server test` passes: 166 passed, 1 skipped (the PostgreSQL integration test, because this local environment has no database URL/service). Corepack could not fetch pnpm because registry DNS is unavailable; npm used the existing workspace dependencies. The actual PostgreSQL path will execute in CI; no workflow run is available from this local checkout.

# Latest continuation (2026-10-15, gated production deployment path)

- Added a `workflow_dispatch` production job restricted to the current `master` SHA, protected by the GitHub `production` Environment and non-canceling concurrency. It uses pinned SSH host keys, transfers the compose/release scripts, and passes the GHCR read token over the SSH input stream.
- CI now builds and publishes the database bootstrap image as well as API/web and records all three image digests in tagged releases. The remote deploy script pins the first DB image in its state file and does not upgrade PostgreSQL on later application deploys; it serializes with `flock`, backs up before migrations, smoke-checks API/TLS/WebSocket routing, and restores previous API/web digests on failure.
- Backup credentials come from the external `.env` and are passed only to the database commands, so the backup helper can provision its read-only role on an existing container without recreating PostgreSQL first.
- Updated `.env.example` to use buildable local tags and documented VPS/GitHub Environment setup and the outstanding off-host backup requirement. The Compose web healthcheck now probes Caddy's loopback admin endpoint; the deployment script separately probes the public site.
- Not verified against GitHub Actions, a Linux shell, Docker, PostgreSQL, or a VPS in this local Windows sandbox. The GitHub workflow now has `bash -n` plus mutable-tag rejection checks; production credentials and target are intentionally not configured. No upload.

# Latest continuation (2026-10-15, deployment-path configuration check)

- `docker compose --env-file .env.example -f compose.yml config --quiet` and the local dev overlay both pass. `npm --prefix apps/server test` passes 166 tests; the real PostgreSQL integration case is the single skip on this host.
- Deployment and backup shell scripts, the GitHub workflow, PostgreSQL startup, smoke checks, and rollback have not run on Linux or a VPS. The updated CI will syntax-check scripts and reject mutable deploy tags, but it has not run because the repository is not uploaded. The task remains active.

# Latest continuation (2026-10-15, real PostgreSQL two-client flow)

- Added a PostgreSQL-backed Fastify integration scenario: register two independent sessions, open two authenticated WebSocket clients, create valid decks through the HTTP API, create/join a room, select and ready both decks, start one match, and verify each seat gets only its own private hand snapshot. It then concedes through the real WebSocket protocol, retries the same command, and checks that PostgreSQL stores one version increment and one receipt. The CI PostgreSQL service enables this test through `BFW_TEST_DATABASE_URL`.
- Local `npm --prefix apps/server test` passes: 166 passed, 2 skipped because this machine has no PostgreSQL URL/service. This exercises real HTTP/WS paths in CI but is not a browser-context test; independent browser acceptance remains open.

# Latest continuation (2026-10-15, PostgreSQL account acceptance)

- Расширил двухклиентский PostgreSQL integration test: два одновременных запроса с разным регистром и пробелами нормализуются в один username; ожидаются один успешный ответ и один `USERNAME_TAKEN`. Там же прямая попытка изменить username проверяет SQLSTATE `23514` и сохранение исходного значения.
- `npm --prefix apps/server test`: 166 passed, 2 skipped, 0 failed. Новые PostgreSQL assertions добавлены, но здесь пропущены вместе с остальными DB integration tests без `BFW_TEST_DATABASE_URL`; их выполнение ожидает PostgreSQL-сервис в CI.

# Latest continuation (2026-10-15, WebSocket runtime and PostgreSQL acceptance)

- Исправил порядок регистрации `/ws`: раньше маршрут создавался до выполнения плагина `@fastify/websocket`, поэтому его обработчик вызывался как обычный HTTP handler и завершал upgrade с 500. API-маршруты теперь регистрируются после websocket-плагина.
- Полный `apps/server` набор прошёл с одноразовым PostgreSQL 18: 169/169, включая миграцию, гонку username, неизменяемость username и двухклиентский HTTP/WebSocket сценарий матча, приватные snapshots и retry concede. Дополнительный тест проверяет, что websocket upgrade проходит authentication hook.
- Проверки игрового ядра 251/251, contracts 18/18, card-effects 249/249, online snapshot 1/1 и local combat 2/2 прошли. `npm run build` и `npm --prefix apps/server run build` прошли; Vite сообщает о chunk 622.32 кБ выше advisory 500 кБ.
- Не выполнены: запуск всего Compose-стека, восстановление backup, проверка через два настоящих браузерных контекста и production deploy. Docker Engine недоступен; политика браузерного инструмента запрещает открыть localhost, поэтому эту UI-приёмку не подменял обходным запуском. Нет настроенных VPS/domain/credentials. No Git upload.

# Latest continuation (2026-10-15, entry damage target)

- Реализовал для каталожной карты «Схизм» выбор существа или здания как отдельный `choice.resolve`: сервер публикует варианты только игроку, повторно проверяет цель, применяет стандартные триггеры урона и увеличивает версию отдельной командой. Тест сначала воспроизвёл `UNSUPPORTED_EFFECT`, после исправления прошёл.
- `node --test packages/game-core/src/match.test.mjs`: 247/247; `npm run type-check` проходит. Остались 10 найденных разрешённых карт с неподдержанными эффектами, а также полный Compose runtime, двухбраузерная приёмка и фактический backup/restore/deploy; локальный Docker Engine и production параметры недоступны. No Git upload.
# Latest continuation (2026-10-15, entry save and sacrifice choices)

- «Вондерноп» берёт верхнюю карту из каждой непустой колоды, сброса и сожжённых карт и кладёт её в сбережения; переиспользуется `entrySavePiles` и `takePileCard`.
- «Ачивари» теперь показывает приватный выбор союзного существа, уничтожает выбранную карту через общий death resolver и только после этого лечит владельца на 5, с общим лимитом здоровья 45. Интерфейс явно описывает обе операции.
- RED/green проверки для обеих карт, «Схизмы», затем полный `match.test.mjs` (249/249), `npm run type-check` и `npm run build` прошли. Vite оставляет advisory на JS chunk 622.80 кБ.
- По ранее воспроизводимому аудиту остаются ещё 8 неподдержанных эффектов разрешённых карт; Compose, двухбраузерная приёмка и runtime backup/restore/deploy не проверены. No Git upload.
# Latest continuation (2026-10-15, allied card save on entry)

- «Ваня Веремеев» использует приватный выбор союзного существа или здания и перемещает карту в сбережения. Снаряжённый предмет отправляется в сброс; death effect карты остаётся на существующем общем обработчике.
- Точечный RED/green тест и полный `node --test packages/game-core/src/match.test.mjs` проходят: 250/250. `npm run build` проходит; JS chunk — 622.99 кБ, выше advisory 500 кБ.
- По аудиту остаются 7 эффектов разрешённых карт. Полный Compose, два браузера, runtime backup/restore и production deploy всё ещё не проверены. No Git upload.
# Latest continuation (2026-10-15, score-gated creature return)

- «Вкидгранник» при выполненном «Счёт <2» предлагает приватный выбор незамороженного существа; сервер возвращает карту в руку её владельца штатным helper, а снаряжённый предмет уходит в сброс. Проверка подтверждает, что соперник не получает приватные варианты выбора.
- Тест game-core прошёл вместе со всем набором: 251/251. `npm run build` проходит; JS chunk 623.19 кБ превышает advisory 500 кБ.
- По текущему аудиту осталось 6 разрешённых карт с неподдержанными эффектами: «Эмптинессссс», «Блузк», «ГендаБосс», «Джекс», «Джон Роблокс» и «Заб». Compose, два браузера, backup/restore и production deploy по-прежнему не проверены. No Git upload.
# Latest continuation (2026-10-15, enemy building control)

- «Заб» теперь приватно выбирает вражеское здание и меняет его владельца. Повторная проверка запрещает выбирать своё здание и цели вне сохранённого списка; если вражеских зданий нет, карта разыгрывается без зависшего пустого выбора.
- Проверки прошли: `node --test packages/game-core/src/match.test.mjs` — 252/252; `npm run type-check`; `npm run build`. JS chunk 623.39 кБ превышает advisory 500 кБ.
- Остаются 5 разрешённых карт с неподдержанными эффектами: «Эмптинессссс», «Блузк», «ГендаБосс», «Джекс» и «Джон Роблокс». Compose, два браузера, runtime backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, Emptinessssss and Jex)

- «Эмптинессссс» выполняет серверный бросок гамбы при розыгрыше, потребляет накопленный бонус, на результате 1–4 приватно предлагает существо и наносит ему по 1 урону за каждое существо на поле; на 5–6 эффекта нет. Тест покрывает обе ветки.
- «Джекс» предлагает приватно выбрать живое незамороженное существо без белых жетонов, затем трижды выбрать один из шести типажей. Сервер и runtime-схема проверяют каждое значение, состояние выбора принадлежит матчу.
- Проверки: game-core 254/254, contracts 19/19, `npm run type-check`, `npm run build`. Vite сообщает advisory о JS chunk 624.23 кБ выше 500 кБ.
- Остались 3 неподдержанных эффекта разрешённых карт: «Блузк», «ГендаБосс» и «Джон Роблокс». Compose, два браузера, runtime backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, GendaBoss)

- «ГендаБосс» наносит владельцу 30 урона и добавляет его существующим и будущим существам +2 к атаке, +2 к текущему и максимальному здоровью и +1 к скорости. Число применений хранится в состоянии матча отдельно для каждого игрока; при смертельном самоуроне сервер завершает матч.
- Проверки после изменений: game-core 255/255, contracts 19/19, `npm run type-check`, `npm run build`. Vite сообщает advisory о JS chunk 624.25 кБ выше 500 кБ.
- Остались 2 неподдержанных эффекта разрешённых карт: «Блузк» и «Джон Роблокс». Compose, два браузера, runtime backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, John Roblox)

- «Джон Роблокс» приватно предлагает живое незамороженное здание, затем только соседние пустые сокеты нейтральных рядов. Сервер повторно проверяет здание и допустимые координаты; при отсутствии подходящей цели эффект не создаёт пустой выбор.
- Проверки прошли: game-core 256/256, contracts 19/19, `npm run type-check`, `npm run build`. Vite сообщает advisory о JS chunk 624.46 кБ выше 500 кБ.
- Остался 1 неподдержанный эффект разрешённой карты: «Блузк». Compose, два браузера, runtime backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, Bluzk)

- «Блузк» приватно выбирает союзное существо, отправляет его в сбережения и по выполненному «Счёт <1» даёт верхнюю карту колоды для бесплатного розыгрыша. Разрешение бесплатного розыгрыша хранится только в матче, скрыто от соперника, снимается после выхода карты из руки и поддерживает обычное размещение существа/здания, экипировку предмета или розыгрыш заклинания.
- Проверки прошли: game-core 264/264, card-effects 249/249, contracts 19/19, online snapshot 1/1, local combat 2/2, server 167 passed + 2 skipped, `npm run type-check`, `npm run build`, Compose config validation. Vite сообщает advisory о JS chunk 624.52 кБ выше 500 кБ.
- Все 11 ранее найденных разрешённых карт с неподдержанными эффектами теперь обработаны. Bluzk также проходит score-fail ветку; бесплатный розыгрыш проверен для существа, предмета и заклинания. PostgreSQL-тестовый кластер не удалось запустить из-за запрета sandbox на bind localhost; оба DB-теста остались skipped.
- На этом историческом этапе оставались обязательные проверки: Compose runtime, два независимых браузера, восстановление backup и production deploy. Полное использование общего game-core локальным режимом также требовало отдельного аудита/переноса. Последующие проверки и прогресс описаны ниже; Git upload отложен.

# Latest continuation (2026-10-15, local movement through game-core)

- Обычное перемещение локального режима теперь вызывает `applyCommand(..., 'unit.move')` и принимает состояние поля, игроков, ресурсов, пшеницы и движение как результат общего игрового ядра. В обработчик ядра добавлены уже существовавшие в локальной игре триггеры Базилика и Cheap Trick.
- Первый вариант импорта поднял основной JS chunk с 624.52 кБ до 750.13 кБ. Создание стартового матча выделено в `match-setup.ts`, основной `match.ts` оставлен отдельным динамическим chunk. Последний `npm run build` прошёл: основной chunk 628.85 кБ и `match` chunk 131.25 кБ.
- Перемещение через вытеснение и бесплатное движение в начале хода пока используют локальные обработчики. Полный parity тест локального и онлайн движков и acceptance проверки Compose/двух браузеров/backup/production остаются незакрыты. No Git upload.

# Latest continuation (2026-10-15, server-side creature push)

- `card.play` в `game-core` поддерживает постановку существа на занятую домашнюю клетку через вытеснение непрерывной цепочки существ к краю доски. Здания, неподвижные/недоступные существа, закрытая цепочка и движение в заблокированный ход отклоняются до списания ресурсов. Перемещённые карты получают триггеры движения, которые локальные правила уже применяли при вытеснении.
- Новые проверки покрывают сдвиг цепочки и отказ без списания маны; game-core — 266/266, `npm run build` и type-check проходят. Production chunks: основной 628.85 кБ, игровой 131.72 кБ.
- Локальный розыгрыш всё ещё выполняет вытеснение собственным обработчиком, хотя серверное правило уже реализовано; следующий этап — убрать этот обход и продолжить покрывать остальные пользовательские действия общей командной моделью. Compose runtime, два браузера, backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, shared creature push validation)

- Вычисление линии вытеснения вынесено в общий `creaturePushLine` в `packages/game-core/src/card-effects.ts`. Его вызывают и серверный `card.play`, и локальный режим; триггеры перемещённых карт остаются частью каждого режима. Добавлен тест порядка всей цепочки.
- Проверки прошли: точечный тест общего helper, game-core 266/266, `npm run build` и Vue type-check. Основной chunk 629.00 кБ; `match` chunk 131.49 кБ.
- Локальные игровые переходы помимо геометрии вытеснения и обычного перемещения всё ещё исполняются отдельно. Не проверены весь Compose runtime, два browser-контекста, backup/restore и production deploy. No Git upload.

# Latest continuation (2026-10-15, workspace verification)

- Перепроверены актуальные наборы: game-core 267/267, card-effects 250/250, contracts 19/19, server 167 passed + 2 skipped, online snapshot 1/1 и local combat 2/2; всего 706 прошло, 2 PostgreSQL-теста пропущены. Vue type-check и production build прошли. Основной JS chunk 629.33 кБ, игровой match chunk 131.01 кБ.
- `docker compose -f compose.yml -f compose.dev.yml config --quiet` проходит с временными значениями переменных из `.env.example`. Docker Engine недоступен (pipe `dockerDesktopLinuxEngine` отсутствует), поэтому контейнеры не запускались.
- Оба PostgreSQL-интеграционных теста пропущены без `BFW_TEST_DATABASE_URL`. Подготовленный локальный кластер не смог открыть TCP-порт 55432 (`Permission denied`); Vite также не удалось подключить к localhost из этой среды. Браузерный acceptance не выполнен.
- Онлайн-перенос 11 ранее неподдержанных разрешённых карт завершён. Остаются full Compose runtime, независимые браузерные клиенты, фактический backup/restore, production deploy и дальнейшее сближение локальных игровых переходов с game-core. No Git upload.

# Latest continuation (2026-10-15, local direct attack through game-core)

- Локальная прямая атака существа по игроку без коронного эффекта теперь вызывает `applyCommand('unit.attackPlayer')`. Общее применение команды извлечено и переиспользуется обычным локальным перемещением; оно синхронизирует итоговые игроки, поле и состояние матча. Коронные атаки остаются в локальном обработчике, чтобы сохранить его интерактивные выборы.
- Добавлен тест делегирования прямого удара в game-core. Проверки после изменения: card-effects 251/251, game-core 267/267, local combat 2/2, Vue type-check и production build прошли. Основной JS chunk 630.31 кБ, игровой match chunk 131.01 кБ.
- Полный Compose runtime, два браузерных клиента и backup/restore по-прежнему не проверены: Docker Engine недоступен, а sandbox запрещает локальные TCP bind. Production deploy также не выполнялся; Git upload не делался.

# Latest continuation (2026-10-15, local ordinary attacks through game-core)

- Обычные атаки существ по картам из клика и перетаскивания теперь используют `applyCommand('unit.attack')`. Атаки с коронными/смертельными/ловушечными эффектами, ройными триггерами, дополнительным уроном и незакрытым интерактивным выбором остаются в локальном резолвере.
- Добавлен тест делегирования обычной атаки; адаптирован изолированный тест «Жёлтого алмаза» к новому UI маршруту. `npm run test:card-effects` прошёл (252/252), `npm run build` и Vue type-check прошли. Основной JS chunk 631.93 кБ, `match` chunk 131.01 кБ.
- Карты с 11 ранее неподдержанными эффектами завершены. Задачи проекта в целом остаются: перенос оставшихся локальных переходов/особых атак и parity, полный Compose runtime, два браузера, backup/restore, production deploy. Для последних проверок нужны Docker/DB и deploy окружение; в этой среде они недоступны. No Git upload.
# Latest continuation (2026-10-15, local turn ending through game-core)

- Обычное завершение хода и UI варианты без сыгранной карты теперь отправляют `turn.end` в общий движок. Выбранные для сброса карты получают instance ID и передаются ядру; очистка ресурсов, временных эффектов, смена игрока и раунда берутся из результата команды.
- Если ядру нужен неподдержанный локальным экраном интерактивный выбор, локальный fallback сохраняет прежнее разрешение хода и применяет выбранное изменение лимита руки/сброс. Добавлены проверки делегирования и no-play fallback.
- Проверки: card-effects 255/255, game-core 267/267, Vue type-check и production build прошли. Основной JS chunk 632.91 кБ, `match` chunk 131.01 кБ; остаётся предупреждение Vite о chunk больше 500 кБ.
- Неперенесённые действия с особыми картовыми эффектами всё ещё могут идти через локальные обработчики. Полный Compose runtime, PostgreSQL acceptance, два браузера, backup/restore и production deploy не выполнены; Git upload не делался.
# Latest continuation (2026-10-15, crown direct attacks through game-core)

- Локальная прямая атака теперь отправляется в `unit.attackPlayer` и для поддерживаемых коронных эффектов. Если ядро возвращает выбор, которого локальный интерфейс не обрабатывает, команда не коммитится и используется существующий локальный резолвер.
- `npm run build` и game-core 267/267 прошли. В `card-effects.test.mjs` сейчас 222/222 проходят, но при правке тестового извлечения direct-функции ошибочно удалён блок последующих тестов; восстановление покрытия остаётся обязательным до того, как считать этот результат полным. Изменений Git не отправлял.
# Latest continuation (2026-10-15, local crown attacks through game-core)

- Локальные атаки с коронным эффектом больше не обходят общий движок заранее. Они отправляют `unit.attack` в `game-core`; если ядро отклоняет неподдержанный эффект или требует интерактивный выбор, сохраняется существующий локальный резолвер.
- Регрессионный тест подтверждает делегирование атаки «Минта» с коронным эффектом. Точечный тест прошёл, game-core 267/267, Vue type-check и production build прошли. Основной chunk 632.27 кБ; предупреждение Vite о размере остаётся.
- Восстановление удалённых тестов `src/card-effects.test.mjs` остаётся незакрытым. Это изменение не считалось проверкой полного набора карточных тестов. No Git upload.

# Latest continuation (2026-10-15, local non-interactive abilities through game-core)

- Локальные способности, распознанные общим парсером без выбора цели, теперь отправляют `ability.activate` в game-core. Это включает, например, бонус к следующей атаке и простые ресурсные/статусные операции. Операции с выбором и изменение следующего счёта остаются на локальном интерфейсе; unsupported/invalid команды не коммитятся и идут через прежний обработчик.
- Добавлен тест делегирования способности. `npm run test:card-effects` — 267/267, `npm run test:game-core` — 267/267, `npm run build` прошёл. Основной JS chunk 632.94 кБ, Vite предупреждает о размере.
- Важно: покрытие `card-effects.test.mjs` всё ещё требует сверки с потерянным блоком прежних тестов; зелёный прогон текущего файла не подтверждает восстановление тех проверок. Full Compose runtime, два браузера, backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, broader local ability delegation)

- Локальный режим теперь пробует передать в `game-core` все способности, кроме «следующего изменения счёта», где UI должен сначала запросить значение. Команды с pending choice, неизвестными операциями и целями, требующими локального UI, не коммитятся и используют прежний обработчик.
- Тесты адаптированы под асинхронное делегирование и fallback: карточные эффекты 223/223, game-core 267/267; `npm run build` прошёл. Vite warning: основной chunk 632.93 кБ.
- Набор карточных тестов текущий и проходит, но прежний удалённый блок из него восстановить пока не удалось. Продолжаются перенос оставшихся переходов, полный Compose runtime, независимые браузеры, backup/restore и production deploy. No Git upload.

# Latest continuation (2026-10-15, online regression verification)

- После расширения делегирования способностей перепроверены все имеющиеся наборы: card-effects 223/223, game-core 267/267, contracts 19/19, server 167 passed + 2 skipped (DB), online snapshot 1/1, local combat 2/2; всего 679 прошло, 2 PostgreSQL-теста пропущены без test DB. `npm run build` и Vue type-check проходят.
- Карточные тесты включают текущие проверки, но не заменяют ранее удалённый блок из тестового файла; пробел покрытия остаётся зафиксирован. Docker runtime, полноценный двухбраузерный сценарий, backup/restore и production deploy не выполнены. No Git upload.

# Latest continuation (2026-10-15, local creature/building plays through game-core)

- Локальный `play` переведён на async-путь для существ и зданий: `card.play` передаётся ядру до локального списания ресурсов; успешное состояние заменяет локальное, а команда с отклонённым эффектом/выбором возвращается к прежнему обработчику без фиксации. Розыгрыш поддерживает instance ID карт из общей настройки матча.
- Добавлена блокировка повторного действия на время async-команды и тест делегирования существа/здания. Проверки: card-effects 224/224, game-core 267/267, contracts 19/19, server 167 passed + 2 skipped (PostgreSQL), online snapshot 1/1, local combat 2/2; всего 680 passed, 2 skipped. `npm run build` и Vue type-check прошли.
- Проверен production build: основной chunk 633.68 кБ, выше advisory 500 кБ. Полный Docker runtime, реальный сценарий в двух браузерах, backup/restore и production deploy не проверены. Ранее удалённый блок тестов остаётся невосстановленным. No Git upload.

# Latest continuation (2026-10-15, local item equips through game-core)

- Локальный розыгрыш предмета теперь вызывает `item.equip` до списания ресурсов; ядро применяет бонусы характеристик, щиты, пассивные эффекты и лимиты руки. При отклонении правила остаётся прежний локальный обработчик. Добавлен тест передачи instance ID, цели и способа оплаты.
- Проверки: card-effects 225/225, game-core 267/267, contracts 19/19, server 167 passed + 2 skipped (PostgreSQL), online snapshot 1/1, local combat 2/2; суммарно 681 passed и 2 skipped. `npm run build` и Vue type-check прошли.
- Основной chunk 634.23 кБ превышает Vite advisory. Compose runtime, независимые браузеры, backup/restore и production deploy не проверены. Прежний потерянный блок тестов не восстановлен. No Git upload.

# Latest continuation (2026-10-15, local spell casts through game-core)

- Локальная команда `play` теперь передаёт заклинания в `spell.cast` до локального списания ресурсов. Цель кодируется как unit/player/cell; ядро рассчитывает руку, здоровье, ресурсы и эффекты. Поддерживаемые интерактивные lifecycle choices отклоняются до фиксации и остаются в локальном резолвере.
- Добавлен тест передачи instance ID и цели. Проверки: card-effects 226/226, game-core 267/267, contracts 19/19, server 167 passed + 2 skipped (PostgreSQL), online snapshot 1/1, local combat 2/2; всего 682 passed и 2 skipped. `npm run build` и Vue type-check прошли.
- Основной production chunk 634.91 кБ, выше advisory 500 кБ. Full Compose runtime, два браузера, backup/restore и production deploy не проверены. Прежний тестовый блок не восстановлен. No Git upload.

# Latest continuation (2026-10-15, prevent duplicate local start-turn effects)

- Устранён двойной старт хода в локальном режиме: успешный `turn.end` уже выполняет start-turn эффекты и выдачу ресурсов в game-core, поэтому handoff теперь только показывает результат и вычисляет UI состояние руки/лимита. При неподдержанном выборе `turn.end` команда не коммитится, и fallback по-прежнему запускает прежнюю локальную процедуру.
- Добавлен регрессионный тест handoff и проверка флага после `turn.end`. Все текущие наборы: card-effects 227/227, game-core 267/267, contracts 19/19, server 167 passed + 2 skipped (PostgreSQL), online snapshot 1/1, local combat 2/2; суммарно 683 passed, 2 skipped. Production build и Vue type-check прошли.
- Основной chunk 635.28 кБ остаётся выше advisory 500 кБ. Docker runtime, two-browser acceptance, backup/restore и production deploy не проверены; прежний потерянный блок тестов не восстановлен. No Git upload.

# Latest continuation (2026-10-15, correct initial local turn resources)

- Первый локальный handoff теперь уважает начальное состояние `createMatch`: открывающие 4 карты и 1 ману/энергию уже подготовил движок, поэтому локальный обработчик не запускает start-turn начисление второй раз. Добавлен регрессионный тест первого handoff.
- Проверки: card-effects 228/228, game-core 267/267, contracts 19/19, server 167 passed + 2 skipped (PostgreSQL), online snapshot 1/1, local combat 2/2; всего 684 passed и 2 skipped. `npm run build` и Vue type-check прошли.
- Основной chunk 635.45 кБ остаётся выше Vite advisory 500 кБ. Docker runtime, два браузера, backup/restore и production deploy по-прежнему не проверены. Сверка с потерянным блоком прежних тестов остаётся открытой. No Git upload.

# Latest continuation (2026-10-15, online pending-choice guidance)

- В `OnlineLobby` добавлены явные инструкции для трёх уже обрабатываемых выборов: цель «Внешнего рая», здание для уничтожения и существо, у которого забирают предмет. Остальные варианты уже имели собственный prompt или общий список доступных вариантов.
- Сопоставление union `PendingChoiceKind` с проверками компонента подтвердило UI-обработку всех 41 типов. `npm run test:online-snapshot` прошёл, production build и Vue type-check прошли. Основной JS chunk 636.01 кБ, выше advisory 500 кБ. Docker runtime, два браузера, backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, fix local ability command routing)

- Исправлена ошибка маршрутизации способностей: локальный клиент отправлял `ability.activate`, которого нет в контракте; ядро принимает `ability.use`. Проверка выбора команды сначала воспроизвела отказ, затем прошла после исправления. Проверки `src/card-effects.test.mjs`, `npm run test:game-core`, `npm run type-check` и `npm run build` прошли. Основной JS chunk 636.00 кБ; Vite advisory 500 кБ остаётся.
- Это устраняет отказ при делегированных способностях локального режима. Full Compose runtime, два браузера, backup/restore и production deploy остаются непроверенными; прежний потерянный блок тестов всё ещё не восстановлен. No Git upload.

# Latest continuation (2026-10-15, route score adjustment through game core)

- Локальный выбор способности повышения/понижения порога счёта теперь передаёт направление вместе с `ability.use` в game-core. Ядро списывает чёрные жетоны, отмечает способность использованной и сохраняет корректировку для следующего эффекта счёта; локальный обработчик больше не меняет эти поля отдельно. Добавлена регрессионная проверка маршрута и очистки UI выбора.
- Проверки: новая регрессия, game-core 267/267, Vue type-check и production build прошли. Основной JS chunk 636.20 кБ, выше Vite advisory 500 кБ. Compose runtime, два браузера, backup/restore и production deploy не проверены; Git upload не выполнялся.

# Latest continuation (2026-10-15, local Iceberg choice through game core)

- Локальная способность «Айсберга» теперь хранит `ability-draw-or-limit` в состоянии общего ядра, передаёт выбор через `choice.resolve` и очищает его после применения. Пока выбор ядра открыт, кнопка отмены скрыта, чтобы локальный интерфейс не оставлял матч заблокированным. Новая регрессия подтверждает сохранение pending choice между командами и его разрешение.
- Проверки после адаптации изолированных тестов к общему pending-choice состоянию и async-резолверу: card-effects 231/231, game-core 267/267, Vue type-check и production build прошли. Основной JS chunk 637.19 кБ, выше Vite advisory 500 кБ. Compose runtime, два браузера, backup/restore и production deploy не проверены; Git upload не выполнялся.

# Latest continuation (2026-10-15, local Bibi and healing choices through game core)

- Выбор здания для «Биби» и лечение союзного существа теперь проходят через сохранённые pending choices и `choice.resolve`. Ядро валидирует цель и само применяет уничтожение/лечение, щит и триггеры; локальный клиент больше не платит и не применяет эффект второй раз. Добавлены проверки активации, разрешения выбора и payload.
- Проверки: card-effects 235/235, game-core 267/267, contracts 19/19, server 167 passed + 2 skipped (PostgreSQL), online snapshot 1/1, local combat 2/2, Vue type-check и production build прошли. Основной JS chunk 638.92 кБ, выше Vite advisory 500 кБ. Compose runtime, два браузера, backup/restore и production deploy не проверены. No Git upload.

# Latest continuation (2026-10-15, WebSocket rate limits)

- Исправлен лимит WebSocket по требованиям протокола: общий поток ограничен 20 сообщениями/с, а отдельный лимит 60/мин применяется только к `game.command`, не к handshake и подпискам на snapshot. Добавлены регрессии на 61 подписку без отключения и отказ 61-й игровой команды.
- Проверки: оба новых теста проходят; весь `npm run test:server` — 169 passed, 2 skipped (PostgreSQL); `npm run type-check` прошёл. Полный Compose runtime, два браузера, backup/restore и production deploy остаются непроверенными. No Git upload.

# Latest continuation (2026-10-15, room admission under memory pressure)

- Создание комнаты и приём гостя теперь отклоняются с `503 SERVER_BUSY`, если heap V8 достиг 85% предела. Это сохраняет отсутствие продуктового лимита комнат и не мешает существующему участнику получить своё лобби. Добавлена проверка отказа без частичного добавления участника.
- Проверки: room-manager 10/10, весь `npm run test:server` — 170 passed, 2 skipped (PostgreSQL), `npm run type-check` прошёл. Порог heap — предварительный; до публичного запуска нужен нагрузочный тест и проверка по лимитам контейнера. Полный Compose runtime, два браузера, backup/restore и production deploy не проверены. No Git upload.
- При той же перегрузке новые WebSocket handshake теперь отклоняются HTTP 503 до Upgrade. Повторное соединение существующего участника разрешено только пока не истёк его reconnect grace period; тест подтверждает оба сценария.
- После дополнения: `npm run test:server` — 172 passed, 2 skipped (PostgreSQL); type-check passed.
- Команды матча теперь также отклоняются с `MATCH_PAUSED`, пока комната не в статусе активного матча или один из игроков отключён. Регрессионный тест подтверждает, что игровая транзакция даже не открывается во время disconnect.
- После изменения: `npm run test:server` — 173 passed, 2 skipped (PostgreSQL); `npm run type-check` прошёл.
- Защищены от устаревшего `roomId` изменения колоды/готовности и выход после DB await. Подготовка матча дополнительно сверяет идентификатор комнаты, а не только совпадающую revision; конкурентный тест воспроизводит замену комнаты во время загрузки колод и подтверждает rollback без создания матча.
- После room identity guards: `npm run test:server` — 175 passed, 2 skipped (PostgreSQL); `npm run type-check` прошёл.
- Явный выход из комнаты теперь закрывает локальный доступ сразу при ошибке PostgreSQL и сохраняет abort в общей очереди повторов. Logout также снимает комнату локально до ожидания БД; добавлен route-тест `503 + закрытая комната + queued abort`.
- Проверки после DB-outage leave: `npm run test:server` — 176 passed, 2 skipped (PostgreSQL); `npm run build` прошёл. Основной web chunk 638.92 кБ, выше Vite advisory 500 кБ.
- Финальная перепроверка после logout/leave resilience: `npm run test:server` — 176 passed, 2 skipped; `npm run build` прошёл с тем же advisory по размеру основного chunk. Реальный DB outage и повторный abort в PostgreSQL требуют интеграционной среды; двух PostgreSQL-тестов локально нет.
- PostgreSQL-backed WebSocket acceptance расширен сценарием disconnect → `match.paused` → отклонённая команда без изменения версии БД → reconnect → `match.resync` с приватной рукой. Локально `npm run test:server` остаётся 176 passed + 2 PostgreSQL tests skipped; в CI настроена PostgreSQL service, где этот E2E выполняется. Type-check passed.
- В CI добавлен full Compose smoke: старт всех четырёх сервисов, регистрация аккаунта через Caddy, перезапуск PostgreSQL, повтор миграции/seed, перезапуск API и повторное чтение профиля по прежней cookie. `docker compose ... config --quiet` проходит локально. Полный запуск workflow не проверен: Docker Engine отсутствует; локальный Bash shell check также заблокирован ограничениями запуска Git Bash.
- Проверка `MATCH_PAUSED` перенесена внутрь транзакционной обработки после поиска command receipt: новая команда при паузе отклоняется, но retry уже подтверждённой команды получает ack даже после окончания матча. Добавлены unit- и realtime-регрессии; `npm run test:server` — 177 passed, 2 PostgreSQL tests skipped; `npm run type-check` прошёл.
- При восстановлении связи оба участника получают `room.updated` с актуальным списком соединений; клиент теперь снимает устаревшее сообщение о паузе только когда комната подтверждает, что оба подключены. `npm run test:online-snapshot`, `npm run type-check` и `npm run build` прошли; основной JS chunk — 639.13 кБ (Vite advisory: 500 кБ).
- Локальное завершение хода без сыгранной карты при отсутствии отдельного штрафного выбора теперь отправляет в game-core `turn.end` с `no_penalty`, вместо перехода по независимому локальному резолверу. Проверки: game-core 267/267; production build и type-check прошли. JS chunk — 639.14 кБ (предупреждение Vite выше 500 кБ).
- Обязательный локальный сброс превышения лимита руки теперь разрешает сохранённый выбор через `choice.resolve` в game-core; ранее UI менял руку локально и оставлял ядро с незакрытым `hand-limit-discard`, блокируя следующие команды. Game-core 267/267 и production build/type-check прошли; основной JS chunk — 639.69 кБ (Vite advisory: 500 кБ).
- Лобби принимает `RoomView` только при revision не старше уже отображаемой для той же комнаты. Одна проверка используется для ответов HTTP, reconnect-загрузки и `room.updated`, чтобы запоздавший ответ не откатывал готовность или выбранную колоду. Регрессия `test:online-snapshot` (2/2) и production build/type-check прошли; основной chunk — 639.76 кБ.
- Full Compose CI smoke теперь после сохранения аккаунта создаёт custom-format PostgreSQL backup и восстанавливает его во временную БД, сверяя учётные записи/аватары/колоды/карты колод; временный дамп и БД очищаются при выходе. Workflow локально не запущен из-за недоступного Docker Engine; команды добавлены в CI acceptance.
- Smoke также создаёт через API легальную 30-карточную колоду, чтобы restore drill проверял заполненные `decks` и `deck_cards`. Синтаксис встроенного Node smoke скрипта проверен через `node --check`, `docker compose ... config --quiet` прошёл; контейнерный backup/restore пока не запускался.
- Контроль перегрузки комнат и новых подключений теперь учитывает фактическое потребление cgroup v2/v1 при заданном container memory limit; вне контейнера сохраняется V8 heap fallback. Добавлены проверки порога 85%, unlimited и invalid cgroup значений; `room-manager` — 13/13, `npm run test:server` — 178 passed, 2 PostgreSQL tests skipped, серверный TypeScript build прошёл.
- Compose CI smoke загружает маленький тестовый PNG через профильный API, проверяет возврат WebP после рестарта DB/API и включает avatar row в backup/restore comparison. Node heredoc syntax, генерация PNG через установленный Sharp и `docker compose ... config --quiet` проверены; контейнерный сценарий ждёт запуска GitHub Actions.
- Restore drill теперь сверяет row counts всех 10 прикладных таблиц PostgreSQL (включая сессии, каталог карт и матчи с квитанциями команд), а не только профиль и колоды. Восстановление расширено в `scripts/verify-backup-restore.sh`; локальный запуск требует Docker/PostgreSQL и не выполнен.
- Full Compose acceptance использует двух зарегистрированных игроков, создаёт колоды через API, проходит create/join/select/ready/start через Caddy, сверяет приватность snapshots и сдаёт матч WebSocket-командой до рестарта и restore drill. Node heredoc syntax и Compose config прошли; настоящий Caddy/WebSocket/DB сценарий ждёт запуска GitHub Actions.
- Полная доступная локальная регрессия повторно проверена: card-effects 235/235, game-core 267/267, contracts 19/19, server 178 passed + 2 skipped (PostgreSQL), online snapshot 2/2, local combat 2/2 — 703 passed, 2 skipped. `npm run build` (включая Vue type-check) прошёл; основной chunk 639.76 кБ выше Vite advisory 500 кБ. Docker Compose runtime, PostgreSQL интеграции, два браузерных контекста и production deploy всё ещё требуют внешней среды; Git upload не выполнялся.
- Добавлена регрессия каталога: все 209 разрешённых карт отправляются через соответствующий начальный action (`card.play`, `item.equip` или `spell.cast`); ни одна не отклонена общим `UNSUPPORTED_EFFECT`. `npm run test:game-core` — 268/268. Это подтверждает прохождение проверки допуска, но не заменяет проверки полного разрешения каждого эффекта. Compose config повторно проходит `config --quiet`; Docker Engine, PostgreSQL и WSL на машине недоступны, поэтому runtime smoke/restore не выполнены.
- В CI добавлен отдельный Playwright smoke с двумя независимыми Chromium-контекстами: регистрация, logout/login через UI, создание/вход в комнату, случайные колоды, проверка owner-only старта до готовности гостя, запуск матча, приватные стартовые руки и сдача с возвратом в лобби. `@playwright/test` 1.64.1 зафиксирован в корневом manifest/lockfile; `pnpm install --frozen-lockfile`, `node --check`, версия Playwright и Compose config проходят. Сам браузерный smoke не запущен: локально нет Chromium и доступного Docker API; он будет исполнен в CI после загрузки браузера.
- Аудит активных способностей по всему каталогу разрешённых карт нашёл отсутствующий эффект «Герсон Бум»: ядро отклоняло способность, хотя локальные правила задают 8 маны, цель-врага, 15 урона и сжигание Герсона. Эффект перенесён в `game-core` как приватный выбор цели с повторной серверной валидацией; после выбора применяются урон и death resolver с принудительным сжиганием. Добавлены проверка каждого активного ability (включая способности предметов на носителе) и сценарный тест Герсона. Каталог сейчас содержит 578 карт: 209 без тега `в разработке`, 369 с этим тегом. `npm run test:game-core` — 270/270; `npm run test:server` — 178 passed, 2 PostgreSQL tests skipped (оба PostgreSQL integration-теста отдельно прошли на локальном Compose); `npm run build` прошёл с прежним Vite предупреждением о JS chunk 639.76 кБ.
- После переноса Герсона добавлен серверный регрессионный тест на идемпотентность активации и разрешения цели. Финальная локальная регрессия: card-effects 235/235, game-core 270/270, contracts 19/19, server 179 passed + 2 skipped без `BFW_TEST_DATABASE_URL`, online snapshot 2/2, local combat 2/2; production build/type-check прошли. Оба PostgreSQL integration-теста повторно запущены на одноразовой PostgreSQL 18 базе и прошли (2/2); тестовый контейнер и credentials удалены.

- При расширенном аудите разрешённых start-turn эффектов обнаружен неподключённый в game-core эффект «Сент-Круа». Добавлен приватный двухэтапный выбор самого дешёвого существа и соседнего сокета; разыгрывание бесплатное, проходит через обычный resolver входа и продолжает очередь начала хода. Онлайн-интерфейс показывает выбор карты и клетки, а проекция скрывает его от соперника. Регрессия проверяет оба этапа, бесплатный розыгрыш и приватность. npm run test:game-core — 273/273; card-effects — 235/235; contracts — 19/19; server — 179 passed + 2 skipped без локальной БД; online snapshot — 2/2; type-check и production build прошли. Vite сообщает о JS chunk 640.25 кБ выше порога 500 кБ. Полный браузерный runtime и production deploy не проверены; Git не загружался.

- Аудит онлайн-способностей теперь фиксирует закрытый список четырёх разрешённых специальных резолверов, не разбираемых общим парсером: Библиотекарь, Генератор потех, Конвейерное производство и Тау-пушка. Для этих механизмов уже есть отдельные сценарные тесты; появление новой неразобранной способности потребует явного подключения. Каталожный тест способностей и весь game-core прошли (273/273); production build/type-check прошли. Полный Compose/browser runtime всё ещё не проверен, Git upload не выполнялся.

- Каталожные проверки команд, start-turn триггеров и активных способностей больше не принимают случайные необработанные JS-исключения за допустимую валидацию: исключения обязаны содержать типизированный игровой код; общий UNSUPPORTED_EFFECT отдельно запрещён. Все три каталожных smoke-теста и полный game-core проходят (273/273). Это улучшает аудит ошибок выполнения, но остаётся проверкой допуска/валидации, не полного семантического результата 209 карт.

- Полная локальная acceptance-проверка теперь выполнена на заново собранных из текущего worktree production Docker images (web/API/PostgreSQL). Compose health checks успешны; Playwright с двумя независимыми Chromium contexts прошёл регистрацию, logout/login, create/join room, выбор и готовность колод, проверку запрета старта до готовности гостя, старт матча, приватность рук и сдачу. В отдельном сценарии аккаунт, серверная cookie-сессия, WebP-аватар и сохранённая колода пережили перезапуск PostgreSQL, повторный запуск миграций и перезапуск API. Штатные backup/restore scripts восстановили временную БД и сверили количество строк всех 10 прикладных таблиц. PostgreSQL-backed migration и WebSocket pause/reconnect integration tests — 2/2 прошли на одноразовой БД. Все созданные тестовые контейнеры, volumes, credentials, backup-файлы и уникальные test image tags удалены. Production VPS/domain deploy по-прежнему не выполнялся; Git upload не выполнялся.

- Перепроверен каталог входных эффектов готовых существ/зданий: 14 описаний не распознаются общим supportedEntryEffect parser и обслуживаются точечными card-specific ветками game-core. Для всех 14 в match.test.mjs есть сценарные проверки; добавлен точный каталог исключений, чтобы новый непрочитанный входной эффект ломал аудит. Полный game-core — 274/274; server unit suite — 179 passed + 2 PostgreSQL integration tests skipped при отсутствии локального BFW_TEST_DATABASE_URL. Текущий source до этого прошёл свежий full Compose + Playwright acceptance, рестарты и backup/restore.

- Расширен и выполнен двухбраузерный acceptance smoke на production Compose images: обе независимые сессии зарегистрировались и вошли в комнату, выбрали колоды, начали партию; первый игрок разыграл существо, оба игрока по очереди завершили ход, сдача вернула участников в лобби. Исправлен неоднозначный Playwright locator при двух одинаковых картах в руке. Проверки `node --check scripts/online-browser-smoke.mjs` и полный smoke прошли. Это подтверждает базовый реальный игровой цикл и синхронизацию ходов, но не все 209 игровых эффектов. Git upload не выполнялся.

- Аудит коронных эффектов нашёл готовую карту «TheVolkeR», чей локальный эффект отсутствовал в сетевом ядре. После коронной атаки game-core теперь приватно предлагает владельцу только сохранённые заклинания; выбор переносит заклинание в руку как бесплатное, затем оно проходит обычный серверный spell resolver. UI показывает отдельную инструкцию. Сценарий проверяет приватность, запрет чужого выбора и выбора существа, а также бесплатный розыгрыш выбранного заклинания. Game-core — 275/275, `vue-tsc --build` прошёл. Git upload не выполнялся.

- Каталожный acceptance по коронным эффектам готовых существ и предметов обнаружил отсутствующую поддержку «Pantlessterrorist», «Громила», «Коза» и «Крипер». Ядро теперь удваивает исходящий урон «Pantlessterrorist» и подавляет его контратаку; «Громила» предлагает только две боковые клетки и сервер проверяет направление; «Коза» перемещает цель назад по направлению к её владельцу; корона «Крипера» убивает его через общий death resolver и наносит 4 урона соседним зданиям. Добавлены семантические сценарии этих четырёх правил и каталожная проверка всех доступных crown-trigger карточек. Game-core — 280/280, contracts — 19/19, server — 179 passed + 2 PostgreSQL integration tests skipped без `BFW_TEST_DATABASE_URL`; `vue-tsc --build`, server `tsc --noEmit` и Vite build прошли. JS chunk 640.63 кБ выше advisory 500 кБ. Команды `pnpm` не смогли получить закреплённый Corepack package из-за недоступного registry; проверки выполнены локальными Node/tool бинарниками. Git upload не выполнялся.

- После последних изменений коронных эффектов повторно собраны production Compose images из текущего worktree: все сервисы прошли health checks, двухбраузерный smoke завершил регистрацию, readiness, старт матча, розыгрыш существа, два хода и сдачу. Текущая регрессия: game-core 280/280, card-effects 235/235, server 179 passed + 2 PostgreSQL integration tests skipped без `BFW_TEST_DATABASE_URL`; production build и Vue type-check прошли. Это проверяет основной сетевой цикл и известные сценарии правил, но не доказывает семантическое покрытие всех эффектов 209 готовых карт. JS bundle 640.63 кБ выше Vite advisory 500 кБ. Git upload не выполнялся.

- Браузерный acceptance усилен проверкой полного стартового набора из двух «Обсидиан пчёл»: эти две копии — единственные карты с ценой не выше 2 в acceptance-колоде, поэтому server opening-hand правило обязано положить обе копии в руку. Актуальный production Compose пересобран, health checks успешны, двухбраузерный сценарий с новой проверкой прошёл; node --check scripts/online-browser-smoke.mjs прошёл. Это устраняет зависимость ключевого шага smoke от случайной раздачи. Git upload не выполнялся.
- Двухбраузерный acceptance теперь проверяет приватный выбор эффекта в реальном UI/WebSocket: готовая тестовая колода гарантирует в стартовой руке «Обсидиан пчёлу» и «Ваню Веремеева»; игроки разыгрывают существ, «Ваня» предлагает владельцу сохранить союзную карту, владелец выбирает пчёлу, после чего она появляется в его сбережениях. Проверка ждёт обновления публичного поля на втором клиенте до и после выбора: он не видит панель выбора или список сбережений, а сохранённая пчёла исчезает с публичного поля. Актуальные production Compose images прошли health checks, smoke продолжил ходы, сдачу и возврат в лобби, после чего проверил выход гостя с сохранением комнаты, повторный вход и окончательное удаление комнаты владельцем; ошибок браузера нет. Git upload не выполнялся.

- Полная регрессия текущего worktree: card-effects 235/235, game-core 280/280, contracts 19/19, server 179 passed + 2 PostgreSQL integration tests skipped без BFW_TEST_DATABASE_URL, online snapshot 2/2, local combat 2/2, production build и Vue type-check прошли. Browser smoke в актуальных production Compose images отдельно подтвердил приватный выбор карты, выход гостя с сохранением комнаты, повторный вход и закрытие владельцем. README синхронизирован с фактическим статусом; production deploy и физическая проверка двух устройств остаются невыполненными. Git upload отложен.

- Исправлена потеря локального состояния комнаты при неуспешном запросе выхода: UI теперь очищает комнату только после успешного ответа сервера. Двухбраузерный smoke на пересобранных production Compose images воспроизвёл ответ 503, подтвердил сохранение комнаты у владельца, затем проверил успешный повторный выход и закрытие комнаты. Git upload отложен.

- Дополнительная проверка после этого изменения: `vue-tsc --build` прошёл локальным бинарником; PostgreSQL 18 integration tests `migrate-postgres.test.mjs` и `online-postgres.test.mjs` прошли на одноразовой чистой БД (1/1 каждый, без пропусков). Временная БД удалена. Вызов `pnpm` локально по-прежнему не работает, потому что Corepack не может разрешить registry.npmjs.org; это не мешало запуску установленных локальных инструментов. Git upload отложен.

- Каталожный аудит ловушек теперь отдельно перечисляет все шесть готовых карт с ловушками, включая объединённый текст «Коронный и Ловушка» у «Админского арбалета», и проверяет фактический результат для каждой: отсутствие контратаки, передачу предмета/усиление, уничтожение атакующего, передачу контроля и урон владельцу. Game-core регрессия: 281/281 проходит.
- Death-effect audit continued: online «Ёжик» now privately offers living board targets, plus the opposing player only when the card died on its owner's start row; resolving a card target deals 1 damage then applies −1 attack. Added owner-privacy, target outcome, and direct-player outcome regressions. «ИНТИВИ» keep/discard choice is accepted by the runtime contract. `node --experimental-strip-types --test packages/game-core/src/*.test.mjs packages/contracts/src/*.test.mjs` — 308/308 pass; `vue-tsc --build` passes. Compose/browser acceptance was pending at this checkpoint and passed in the subsequent relocation validation below. Git upload remains deferred.
- Client workspace now matches the target layout: Vue source, tests, public card assets, Vite and Vue TS configs live in `apps/web`; root commands delegate to `@bfw/web`; `Dockerfile.web` builds and serves `apps/web/dist`. Added `test:workspace` and a CI gate for this boundary. README now documents the workspace layout.
- Verification after relocation: workspace layout test 1/1; moved card/local-combat/snapshot tests 239/239; full suite 726 passed, 2 PostgreSQL tests skipped before rerunning them on a fresh disposable PostgreSQL 18 container (2/2 passed). Current `vue-tsc --build` passes; Vite build and frozen-lockfile web/API Docker image builds pass. Fresh production Compose images passed the full two-browser smoke, including private choice, guest return, owner leave failure and retry; all temporary containers, volumes, images and test secrets were removed. Windows `npm run build` could not start because Corepack could not resolve `registry.npmjs.org`; the Docker build used the pinned pnpm and succeeded. Vite still warns that the 642.12 kB JS chunk exceeds its 500 kB advisory. Production VPS deploy and physical two-device test remain unperformed; Git upload remains deferred.
- Full local regression after the «Ёжик» death choice and «ИНТИВИ» contract update: 726 passed, 2 PostgreSQL integration tests skipped in the combined run and then passed 2/2 against a disposable PostgreSQL 18 instance; `vue-tsc --build` and Vite production build passed. The current production Compose images then passed the two-browser acceptance smoke. Windows Corepack DNS prevented the root `npm run build` wrapper from starting; the frozen-lockfile Docker build passed. No Git upload.
- Local targeted single-target abilities now keep `ability-damage-target` choices in the local game-core state and resolve unit or opponent selections through `choice.resolve`, avoiding the parallel UI damage path and double resource payment. Added an adapter integration regression using the real `applyCommand`, plus UI target-routing tests. Card-effects 239/239, game-core 289/289, contracts 19/19, server 179 passed + 2 PostgreSQL tests skipped; Vue and server type-checks pass. Git upload remains deferred.
- Local multi-target ability choices now also resolve in game-core: «Игла»'s damage and healing modes each collect three distinct targets, apply once, and clear the pending choice. Hand clicks and the action-panel cancel button cannot abandon a mandatory core choice; a regression covers the hand-click case. Card-effects 241/241, game-core 289/289, contracts 19/19, server 179 passed + 2 PostgreSQL tests skipped, web/server type-checks and Vite production build pass. Full browser smoke was not repeated for these local-only changes. Git upload remains deferred.
- Local cell and unit target choices for abilities now also use game-core: move-self effects («Абрамс»), move-front («Пудж»), and put-target-on-deck («Закулисье») preserve the core's legal options and resolve movement triggers or pile/item movement there. Added end-to-end adapter tests against the real `applyCommand`; card-effects 243/243, game-core 289/289, contracts 19/19, server 179 passed + 2 PostgreSQL tests skipped. Git upload remains deferred.

- Повторная локальная проверка (2026-10-15): card-effects 243/243, game-core 289/289, contracts 19/19, server 179 passed + 2 PostgreSQL tests skipped, online snapshot 1/1 и local combat 2/2; vue-tsc --build, server TypeScript build и Vite production build прошли. Vite сообщает о главном чанке 645.91 кБ (порог-предупреждение 500 кБ). pnpm не смог разрешить registry.npmjs.org через DNS, поэтому type/build команды запускались из установленного node_modules. Оба Compose-файла проходят config --quiet (production с --env-file .env.example); Docker Engine недоступен, поэтому runtime smoke и PostgreSQL integration повторно не запускались. Сгенерированный apps/web/dist удалён. Production deploy и проверка на физических устройствах остаются открытыми; Git upload отложен.
- Acceptance-перепроверка (2026-10-15): docker compose --env-file .env.example -f compose.yml config --quiet и docker compose -f compose.dev.yml config --quiet прошли. Server suite повторно: 179 passed, 2 PostgreSQL integration tests skipped, 0 failed. Unit-регрессии покрывают конкурентную регистрацию, версии/квитанции команд, приватность snapshots и отказ транзакции; два database-backed сценария требуют PostgreSQL и в этом окружении не запущены. Docker daemon недоступен, поэтому compose/browser smoke не стартовал. Git upload отложен.

- Runtime blocker rechecked (2026-10-15): Docker Desktop process exits without creating dockerDesktopLinuxEngine; WSL status returns Wsl/ERROR_ACCESS_DENIED. Compose validation and server unit checks remain available, but full runtime, PostgreSQL integration, backup/restore and two-browser smoke need Docker/WSL access. Production deploy additionally needs the actual VPS/domain and deployment secrets; no upload was made.

- Продолжение 2026-10-16: локальный и онлайн-режимы теперь используют общий компонент GameField с одной DOM-структурой поля, пятью рядами, координатными осями и ориентацией для обеих сторон; ячейки, профили и эффекты остаются управляемыми игровым режимом. Прямую атаку можно выполнить нажатием/клавиатурой по профилю соперника после выбора атакующего существа. Снимки матча теперь добавляют публичные avatar URL из профиля в обоих seat; руки и другие приватные данные остаются только в приватной проекции. Добавлен тест приватности/аватаров. Server TypeScript build, web type-check + production build и server tests прошли (181 passed, 2 PostgreSQL integration tests skipped); отдельный realtime-тест подтверждает обновление обоих seat после завершения хода без смены их seat view. Остальные доступные наборы card-effects, game-core, contracts, online-snapshot, local-combat и workspace прошли; production bundle 647.00 kB сохраняет существующее предупреждение Vite о 500 kB. Compose config проверяется, но runtime и два браузерных контекста не проверены: Docker Desktop Engine недоступен в текущем сеансе.
- Все перемещения с серверным выбором клетки («Абрамс», «Громила», «Посланник креста») теперь выбираются непосредственно на основном поле: отдельная мини-сетка выбора удалена; целевые клетки разблокируются только из серверного allowlist.

- Онлайн-режим, приёмка в двух независимых Chromium-контекстах (2026-10-16): оба игрока зарегистрировались, создали/подключились к комнате, запустили матч на общем поле, поочерёдно сыграли и завершили ходы без переключения seat-view, разрешили приватный выбор эффекта, проверили выход/возврат гостя и сдачу. Браузерный smoke прошёл. Обнаружено и исправлено перекрытие кнопки «Завершить ход» закреплённой панелью ресурсов; web type-check и production build после исправления прошли. Для локального просмотра Vite доступен на http://localhost:8081, API — на http://localhost:3000; база теста временная и изолированная. Публичный production deploy и проверка на физических устройствах не выполнялись.
- Редактор колод (2026-10-16): на главной появилась отдельная кнопка библиотеки колод; аккаунт может создать черновик, назвать его, открыть существующую колоду, сохранить изменения с проверкой revision и удалить через диалог подтверждения. Плитки показывают первые три карты. При регистрации сервер в одной транзакции создаёт три разные легальные стартовые колоды: «Передовая», «Контроль поля» и «Ресурсный прорыв»; без аккаунта эти же наборы доступны в локальном выборе колод. Локальная партия теперь начинается с выбора колоды для каждого игрока. Проверки: web build/type-check, server build, server suite 181 passed/2 PostgreSQL tests skipped, отдельная проверка трёх валидных стартовых колод и двухбраузерный online smoke прошли. Локально доступны http://localhost:8081 и API http://localhost:3000; production не проверялся.

- Исправление игрового поля и перетаскивания (2026-10-16): поле онлайн вынесено из закреплённой панели управления, удалены конфликтующие пропорции ячеек и размеры руки; оба режима используют общую геометрию GameField и захват указателя с корректной отменой. Touch-action предотвращает отмену перетаскивания браузером. Локальный адаптер очищает Vue-прокси перед клонированием в game-core и синхронизирует текущего игрока/раунд после команды. Онлайн сохраняет ориентацию владельца аккаунта и блокирует его действия в чужой ход; публичная проекция передаёт состояние готовности открытых существ, не раскрывая его у перевёрнутых карт.
  Проверки: web build/type-check и server build прошли; game-core/contracts/online-snapshot/local-combat — 312 passed; server/card-effects/workspace — 425 passed, 2 PostgreSQL integration tests skipped. Исправлены устаревшие проверки редактора после его перевода на сохранённые колоды. Два независимых Chromium-контекста прошли online-browser-smoke (лобби, приватный выбор, сдача, выход/возврат гостя). Новый scripts/gameplay-browser-smoke.mjs проверил локальный режим мышью/касанием, онлайн с двух аккаунтов, отмену/недопустимый сброс, движение, бой карт и атаку игрока; оба seat проверены на 1280×720, 1920×1080, 390×844 без прокрутки и искажения пропорций. Запуск: BFW_SMOKE_ORIGIN=http://localhost:8081 node --experimental-strip-types scripts/gameplay-browser-smoke.mjs (переменную задать синтаксисом своей оболочки). Реальные физические устройства, production и два DB integration-теста в этом прогоне не проверялись.
