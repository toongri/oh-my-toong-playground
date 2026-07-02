// Type shim for the vendored, declaration-less `picomatch` glob library.
//
// picomatch ships as raw JS with no bundled `.d.ts`, so a bare `import picomatch
// from "picomatch"` resolves to an untyped module → TS7016 (implicit any) under
// strict mode. This ambient declaration supplies only the surface this hook uses
// (matcher.ts): the default export called as `picomatch(glob, options)` returning
// a `(path) => boolean` matcher. Kept intentionally narrow — not `any` — so the
// matcher's contract stays type-checked at the call site.
declare module "picomatch" {
	interface PicomatchOptions {
		bash?: boolean;
		dot?: boolean;
		nocase?: boolean;
		ignore?: string | string[];
	}

	type Matcher = (test: string) => boolean;

	function picomatch(glob: string | string[], options?: PicomatchOptions): Matcher;

	export default picomatch;
}
