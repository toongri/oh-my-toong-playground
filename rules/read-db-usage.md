# Database Read Access

When you need to read from a database to ground a decision — inspecting a row,
confirming a schema, counting records, tracing how data actually looks — go
through the `read-db` skill. It is the sanctioned read-only path: one
SELECT-family statement per call, a read-only session against an `-ro` service,
a statement timeout and a row cap, with the credential taken from `~/.pgpass`
and never placed on argv.
