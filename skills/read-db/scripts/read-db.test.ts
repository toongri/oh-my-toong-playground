// read-db.ts 테스트. 실제 DB에 붙지 않는다 — psql과 brew는 인자·환경을 기록하는 stub이다.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dir, "read-db.ts");
const WORK = mkdtempSync(path.join(tmpdir(), "read-db-test-"));
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

const SERVICE_FILE_CONTENT = `[app-prd-ro]
host=localhost
port=15432

[app-stg-rw]
host=localhost
port=25432

[app-stg-ro]
host=localhost
port=25432
`;

// 인자와 PGOPTIONS를 기록하고 PSQL_STUB_OUT 파일 내용을 stdout으로 낸다.
const PSQL_STUB = `#!/usr/bin/env bash
{
  printf 'PGOPTIONS=%s\\n' "\${PGOPTIONS:-}"
  for a in "$@"; do printf 'ARG=%s\\n' "$a"; done
} >"$CALL_LOG"
[ -n "\${PSQL_STUB_OUT:-}" ] && cat "$PSQL_STUB_OUT"
exit 0
`;

interface Case {
	dir: string;
	bin: string;
	callLog: string;
	run: (args: string[], env?: Record<string, string>) => { status: number | null; stdout: string; stderr: string };
}

function writeExecutable(file: string, content: string): void {
	writeFileSync(file, content);
	chmodSync(file, 0o755);
}

// 케이스마다 새 stub 디렉터리와 서비스 파일을 만든다. PATH에는 stub 디렉터리와
// 시스템 기본 경로만 둬서, 이 머신에 설치된 psql·brew가 끼어들지 못하게 한다.
function setup(options: { psqlOnPath: boolean }): Case {
	const dir = mkdtempSync(path.join(WORK, "case-"));
	const bin = path.join(dir, "bin");
	mkdirSync(bin);
	const serviceFile = path.join(dir, "pg_service.conf");
	writeFileSync(serviceFile, SERVICE_FILE_CONTENT);
	const callLog = path.join(dir, "psql-call.log");
	if (options.psqlOnPath) writeExecutable(path.join(bin, "psql"), PSQL_STUB);
	return {
		dir,
		bin,
		callLog,
		run: (args, env = {}) => {
			const result = spawnSync(process.execPath, [SCRIPT, ...args], {
				encoding: "utf8",
				env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, PGSERVICEFILE: serviceFile, CALL_LOG: callLog, ...env },
			});
			return { status: result.status, stdout: result.stdout, stderr: result.stderr };
		},
	};
}

function callLogLines(c: Case): string[] {
	return readFileSync(c.callLog, "utf8").split("\n");
}

describe("read-db.ts", () => {
	test("인자 없이 실행하면 usage를 내고 실패한다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run([]);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("usage:");
		expect(existsSync(c.callLog)).toBe(false);
	});

	test("-ro로 끝나지 않는 서비스는 거부한다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run(["app-stg-rw", "select 1"]);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("-ro");
		expect(existsSync(c.callLog)).toBe(false);
	});

	test("서비스 파일에 없는 서비스는 거부한다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run(["ghost-ro", "select 1"]);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("ghost-ro");
		expect(existsSync(c.callLog)).toBe(false);
	});

	test("정상 조회는 서비스 이름과 읽기 전용 세션으로 psql을 부른다", () => {
		const c = setup({ psqlOnPath: true });
		expect(c.run(["app-prd-ro", "select 1"]).status).toBe(0);
		const lines = callLogLines(c);
		for (const expected of ["ARG=-w", "ARG=-X", "ARG=--csv", "ARG=ON_ERROR_STOP=1", "ARG=select 1"]) {
			expect(lines).toContain(expected);
		}
		// 안전 옵션은 접속 파라미터로 넘긴다. PGOPTIONS 환경변수는 서비스 섹션에 options=가
		// 있으면 libpq가 통째로 무시하므로, 읽기 전용과 시간 제한이 조용히 사라진다.
		expect(lines).toContain(
			"ARG=service=app-prd-ro options='-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000'",
		);
		expect(lines).toContain("PGOPTIONS=");
	});

	// 접속 문자열(비밀번호 포함 가능)이 psql 인자로 들어가지 않는다.
	test("접속 문자열은 psql 인자에 들어가지 않는다", () => {
		const c = setup({ psqlOnPath: true });
		expect(c.run(["app-prd-ro", "select 1"], { DATABASE_URI: "postgresql://u:hunter2@h:5432/d" }).status).toBe(0);
		expect(readFileSync(c.callLog, "utf8")).not.toContain("hunter2");
	});

	test("쓰기 문장은 거부한다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run(["app-prd-ro", "delete from t"]);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("read-only statement");
		expect(existsSync(c.callLog)).toBe(false);
	});

	// 두 번째 문장으로 읽기 전용 설정을 끄는 우회를 막는다.
	test("여러 문장은 거부한다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run(["app-prd-ro", "select 1; set default_transaction_read_only=off"]);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("one statement");
		expect(existsSync(c.callLog)).toBe(false);
	});

	test("끝 세미콜론과 앞 공백은 허용한다", () => {
		const c = setup({ psqlOnPath: true });
		expect(c.run(["app-prd-ro", "  WITH x AS (select 1) select * from x;  "]).status).toBe(0);
		expect(callLogLines(c)).toContain("ARG=WITH x AS (select 1) select * from x");
	});

	test("출력은 행 상한에서 잘리고 잘렸음을 알린다", () => {
		const c = setup({ psqlOnPath: true });
		const out = path.join(c.dir, "out");
		writeFileSync(out, "id\n1\n2\n3\n4\n5\n");
		const r = c.run(["app-prd-ro", "select id from t"], { PSQL_STUB_OUT: out, READ_DB_MAX_ROWS: "2" });
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("id\n1\n2\n");
		expect(r.stderr).toContain("truncated at 2 rows (of 5)");
	});

	test("상한 이내 출력은 잘렸다고 알리지 않는다", () => {
		const c = setup({ psqlOnPath: true });
		const out = path.join(c.dir, "out");
		writeFileSync(out, "id\n1\n2\n");
		const r = c.run(["app-prd-ro", "select id from t"], { PSQL_STUB_OUT: out, READ_DB_MAX_ROWS: "2" });
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("id\n1\n2\n");
		expect(r.stderr).not.toContain("truncated");
	});

	test("psql이 실패하면 그 종료 코드와 stderr를 그대로 전달한다", () => {
		const c = setup({ psqlOnPath: false });
		writeExecutable(path.join(c.bin, "psql"), "#!/usr/bin/env bash\necho 'ERROR: canceling statement due to statement timeout' >&2\nexit 3\n");
		const r = c.run(["app-prd-ro", "select 1"]);
		expect(r.status).toBe(3);
		expect(r.stderr).toContain("statement timeout");
	});

	// Homebrew libpq는 keg-only라 PATH에 psql이 없을 수 있다.
	test("PATH에 없으면 Homebrew libpq keg에서 psql을 찾는다", () => {
		const c = setup({ psqlOnPath: false });
		const keg = path.join(c.dir, "keg");
		mkdirSync(path.join(keg, "bin"), { recursive: true });
		writeExecutable(path.join(keg, "bin", "psql"), PSQL_STUB);
		writeExecutable(path.join(c.bin, "brew"), `#!/usr/bin/env bash\necho "${keg}"\n`);
		expect(c.run(["app-prd-ro", "select 1"]).status).toBe(0);
		expect(existsSync(c.callLog)).toBe(true);
	});

	test("psql이 없으면 설치 명령을 알려준다", () => {
		const c = setup({ psqlOnPath: false });
		const r = c.run(["app-prd-ro", "select 1"]);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain("brew install libpq");
	});

	test("--help는 사용법, 조회 가능한 서비스, 서비스 추가 방법을 내고 성공한다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run(["--help"]);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("usage:");
		expect(r.stdout).toContain("  app-prd-ro\n  app-stg-ro\n");
		expect(r.stdout).not.toContain("app-stg-rw");
		expect(r.stdout).toContain(".pgpass");
	});

	test("서비스 파일이 없어도 --help는 추가 방법을 알려준다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run(["--help"], { PGSERVICEFILE: path.join(c.dir, "absent.conf") });
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("(none)");
		expect(r.stdout).toContain(".pgpass");
	});

	test("--list는 -ro 서비스만 출력한다", () => {
		const c = setup({ psqlOnPath: true });
		const r = c.run(["--list"]);
		expect(r.status).toBe(0);
		expect(r.stdout).toBe("app-prd-ro\napp-stg-ro\n");
	});
});
