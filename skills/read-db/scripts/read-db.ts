#!/usr/bin/env bun
// PostgreSQL을 읽기 전용으로 한 문장 조회한다.
//
//   read-db.ts --help                 사용법, 조회 가능한 서비스, 서비스 추가 방법을 출력한다
//   read-db.ts --list                 조회 가능한 서비스(-ro) 이름만 한 줄에 하나씩 출력한다
//   read-db.ts <service> "<sql>"      그 서비스에 SQL 한 문장을 실행하고 CSV로 출력한다
//
// 접속 대상은 pg_service.conf의 서비스 이름으로만 받는다. 호스트·계정은 그 파일에,
// 비밀번호는 ~/.pgpass에 있고 둘 다 psql(libpq)이 직접 읽는다. 그래서 접속 문자열이
// 이 스크립트의 인자·환경·출력 어디에도 나타나지 않는다.
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const READ_ONLY_KEYWORDS = ["SELECT", "WITH", "EXPLAIN", "SHOW", "TABLE", "VALUES"];

function die(message: string): never {
	process.stderr.write(`read-db: ${message}\n`);
	process.exit(2);
}

// 서비스 파일이 없으면 조회 가능한 서비스가 없는 것이다.
function readOnlyServices(serviceFile: string): string[] {
	let content: string;
	try {
		content = readFileSync(serviceFile, "utf8");
	} catch {
		return [];
	}
	return [...content.matchAll(/^\[(.*-ro)\]\s*$/gm)].map((match) => match[1]);
}

function helpText(serviceFile: string, maxRows: number, timeoutMs: number): string {
	const services = readOnlyServices(serviceFile);
	return `usage:
  read-db.ts --help
  read-db.ts --list
  read-db.ts <service> "<sql>"

Runs one read-only SQL statement (${READ_ONLY_KEYWORDS.join(", ")}) and prints CSV.
Session: read-only transaction, statement_timeout ${timeoutMs} ms (READ_DB_TIMEOUT_MS),
output capped at ${maxRows} rows (READ_DB_MAX_ROWS).

services in ${serviceFile}:
${services.length > 0 ? services.map((name) => `  ${name}\n`).join("") : "  (none)\n"}
add a service (only names ending in -ro are accepted):
  1. ${serviceFile}
       [<app>-<env>-ro]
       host=<host>
       port=<port>
       dbname=<database>
       user=<read-only account>
  2. ~/.pgpass, mode 0600 — libpq reads the password from here
       <host>:<port>:<database>:<user>:<password>
`;
}

// 한 문장만 받는다. 두 번째 문장으로 `SET default_transaction_read_only = off`를 끼워
// 세션 설정을 끄는 우회를 막기 위해서다. 읽기 전용 트랜잭션 안의 한 문장은
// writable CTE나 EXPLAIN ANALYZE로도 쓰기를 하지 못한다.
// lazy: 문자열 리터럴 안의 세미콜론도 거부한다. 필요해지면 SQL 토크나이저로 바꾼다.
function singleReadOnlyStatement(sql: string): string {
	const statement = sql.trim().replace(/;$/, "").trimEnd();
	if (statement.includes(";")) die("one statement per call");
	const keyword = statement.split(/\s+/, 1)[0].toUpperCase();
	if (!READ_ONLY_KEYWORDS.includes(keyword)) {
		die(`not a read-only statement (${READ_ONLY_KEYWORDS.join(", ")}): ${keyword}`);
	}
	return statement;
}

function isExecutable(file: string): boolean {
	try {
		accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

// Homebrew libpq는 keg-only라 설치돼 있어도 PATH에 psql이 없을 수 있다.
function findPsql(): string {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (dir && isExecutable(path.join(dir, "psql"))) return path.join(dir, "psql");
	}
	const keg = spawnSync("brew", ["--prefix", "libpq"], { encoding: "utf8" }).stdout?.trim();
	if (keg && isExecutable(path.join(keg, "bin", "psql"))) return path.join(keg, "bin", "psql");
	die("psql not found. Install it: brew install libpq");
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const serviceFile = process.env.PGSERVICEFILE ?? path.join(homedir(), ".pg_service.conf");
	const maxRows = Number(process.env.READ_DB_MAX_ROWS ?? 200);
	const timeoutMs = Number(process.env.READ_DB_TIMEOUT_MS ?? 15000);

	if (args[0] === "--help") {
		process.stdout.write(helpText(serviceFile, maxRows, timeoutMs));
		process.exit(0);
	}
	if (args[0] === "--list") {
		process.stdout.write(readOnlyServices(serviceFile).map((name) => `${name}\n`).join(""));
		process.exit(0);
	}
	if (args.length !== 2) die('usage: read-db.ts --help | --list | <service> "<sql>"');
	const [service, sql] = args;

	// 이름이 읽기 전용 계약을 말하는 서비스만 받는다. 이 접미사는 약속일 뿐이므로, 실제
	// 보장은 그 서비스가 읽기 전용 계정이나 읽기 전용 엔드포인트를 가리키게 해서 얻는다.
	if (!service.endsWith("-ro")) die(`service must end in -ro (read-only): ${service}`);
	if (!readOnlyServices(serviceFile).includes(service)) {
		die(`service not in ${serviceFile}: ${service} (run --help)`);
	}
	const statement = singleReadOnlyStatement(sql);

	// lazy: 결과 전체를 메모리에 받은 뒤 자른다(64MB 상한). 서버는 행 상한과 무관하게 전체
	// 결과를 보내므로, 큰 결과는 SQL의 LIMIT으로 줄인다. 상한을 자주 넘으면 스트리밍으로 바꾼다.
	const result = spawnSync(
		findPsql(),
		// -w: 비밀번호가 ~/.pgpass에 없으면 프롬프트로 멈추지 않고 바로 실패한다.
		[`service=${service}`, "-w", "-X", "-A", "--csv", "-v", "ON_ERROR_STOP=1", "-P", "pager=off", "-c", statement],
		{
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				...process.env,
				PGOPTIONS: `-c default_transaction_read_only=on -c statement_timeout=${timeoutMs} -c lock_timeout=3000`,
				PGAPPNAME: "read-db",
				PGCONNECT_TIMEOUT: "10",
			},
		},
	);
	if (result.error) die(`psql failed: ${result.error.message} (result too large? add LIMIT)`);

	// 행 상한은 출력 줄 수로 센다(헤더 1줄 + maxRows줄). 줄바꿈이 든 값은 여러 줄로 세어진다.
	const lines = result.stdout.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	process.stdout.write(lines.slice(0, maxRows + 1).map((line) => `${line}\n`).join(""));
	if (lines.length > maxRows + 1) {
		process.stderr.write(`read-db: truncated at ${maxRows} rows (of ${lines.length - 1}); narrow the query or add LIMIT\n`);
	}
	process.exit(result.status ?? 1);
}
