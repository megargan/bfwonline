CREATE TABLE users (
  id uuid PRIMARY KEY,
  username varchar(24) COLLATE "C" NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 32),
  password_hash text NOT NULL,
  avatar_version integer NOT NULL DEFAULT 0 CHECK (avatar_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_username_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'username is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_username_immutable BEFORE UPDATE OF username ON users
FOR EACH ROW EXECUTE FUNCTION reject_username_change();

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX user_sessions_user ON user_sessions(user_id);
CREATE INDEX user_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE user_avatars (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  body bytea NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 262144),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cards (
  id uuid PRIMARY KEY,
  definition_json jsonb NOT NULL CHECK (jsonb_typeof(definition_json) = 'object'),
  rules_version text NOT NULL,
  is_playable boolean NOT NULL
);

CREATE TABLE decks (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decks_owner ON decks(owner_id, updated_at DESC, id);
CREATE TABLE deck_cards (
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id),
  quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 30),
  PRIMARY KEY (deck_id, card_id)
);

CREATE TABLE matches (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'finished', 'aborted')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  rules_version text NOT NULL,
  engine_version text NOT NULL,
  state_json jsonb,
  winner_user_id uuid REFERENCES users(id),
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (state_json IS NULL OR jsonb_typeof(state_json) = 'object'),
  CHECK (status <> 'active' OR state_json IS NOT NULL),
  CHECK ((status = 'active' AND ended_at IS NULL AND winner_user_id IS NULL AND end_reason IS NULL)
      OR (status = 'finished' AND ended_at IS NOT NULL AND winner_user_id IS NOT NULL AND end_reason IS NOT NULL)
      OR (status = 'aborted' AND ended_at IS NOT NULL AND winner_user_id IS NULL AND end_reason IS NOT NULL))
);
CREATE INDEX matches_active ON matches(id) WHERE status = 'active';
CREATE INDEX matches_ended ON matches(ended_at) WHERE ended_at IS NOT NULL;
CREATE TABLE match_players (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat IN (0, 1)),
  user_id uuid NOT NULL REFERENCES users(id),
  username_snapshot text NOT NULL,
  display_name_snapshot text NOT NULL,
  deck_snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(deck_snapshot_json) = 'object'),
  PRIMARY KEY (match_id, seat),
  UNIQUE (match_id, user_id)
);
CREATE INDEX match_players_user ON match_players(user_id, match_id);
CREATE TABLE match_commands (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  applied_version integer NOT NULL CHECK (applied_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, command_id),
  UNIQUE (match_id, applied_version)
);
