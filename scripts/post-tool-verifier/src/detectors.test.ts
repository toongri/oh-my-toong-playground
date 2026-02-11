import { detectBashFailure, detectWriteFailure } from './detectors.js';

describe('detectBashFailure', () => {
  it('detects "error:" pattern', () => {
    expect(detectBashFailure('Some error: something went wrong')).toBe(true);
  });

  it('detects "failed" pattern', () => {
    expect(detectBashFailure('Build failed with 3 errors')).toBe(true);
  });

  it('detects "cannot" pattern', () => {
    expect(detectBashFailure('cannot find module xyz')).toBe(true);
  });

  it('detects "permission denied" pattern', () => {
    expect(detectBashFailure('Permission Denied: /etc/passwd')).toBe(true);
  });

  it('detects "command not found" pattern', () => {
    expect(detectBashFailure('bash: foo: command not found')).toBe(true);
  });

  it('detects "no such file" pattern', () => {
    expect(detectBashFailure('No such file or directory')).toBe(true);
  });

  it('detects "exit code: N" pattern', () => {
    expect(detectBashFailure('Process ended with exit code: 1')).toBe(true);
  });

  it('detects "exit status N" pattern', () => {
    expect(detectBashFailure('exit status 2')).toBe(true);
  });

  it('detects "fatal:" pattern', () => {
    expect(detectBashFailure('fatal: not a git repository')).toBe(true);
  });

  it('detects "abort" pattern', () => {
    expect(detectBashFailure('Operation aborted by user')).toBe(true);
  });

  it('returns false for clean output', () => {
    expect(detectBashFailure('Build succeeded. All tests passed.')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(detectBashFailure('ERROR: something broke')).toBe(true);
    expect(detectBashFailure('FATAL: crash')).toBe(true);
  });

  it('does not match exit code 0', () => {
    expect(detectBashFailure('exit code: 0')).toBe(false);
  });
});

describe('detectWriteFailure', () => {
  it('detects "error" pattern', () => {
    expect(detectWriteFailure('An error occurred while writing')).toBe(true);
  });

  it('detects "failed" pattern', () => {
    expect(detectWriteFailure('Write operation failed')).toBe(true);
  });

  it('detects "permission denied" pattern', () => {
    expect(detectWriteFailure('Permission denied: /root/file.txt')).toBe(true);
  });

  it('detects "read-only" pattern', () => {
    expect(detectWriteFailure('File system is read-only')).toBe(true);
  });

  it('detects "not found" pattern', () => {
    expect(detectWriteFailure('Directory not found')).toBe(true);
  });

  it('returns false for successful output', () => {
    expect(detectWriteFailure('File written successfully')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(detectWriteFailure('PERMISSION DENIED')).toBe(true);
    expect(detectWriteFailure('READ-ONLY filesystem')).toBe(true);
  });
});
