import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';

import {
  logInfo,
  logSuccess,
  logWarn,
  logError,
  logDry,
} from './logger.ts';

describe('logger 모듈', () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('logInfo', () => {
    it('파란색 [SYNC] 접두사와 함께 stderr에 출력한다', () => {
      logInfo('test message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[SYNC]');
      expect(output).toContain('test message');
      expect(output).toContain('\x1b[34m');
      expect(output).toContain('\x1b[0m');
    });
  });

  describe('logSuccess', () => {
    it('초록색 [SYNC] 접두사와 함께 stderr에 출력한다', () => {
      logSuccess('done');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[SYNC]');
      expect(output).toContain('done');
      expect(output).toContain('\x1b[32m');
      expect(output).toContain('\x1b[0m');
    });
  });

  describe('logWarn', () => {
    it('노란색 [WARN] 접두사와 함께 stderr에 출력한다', () => {
      logWarn('watch out');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[WARN]');
      expect(output).toContain('watch out');
      expect(output).toContain('\x1b[33m');
      expect(output).toContain('\x1b[0m');
    });
  });

  describe('logError', () => {
    it('빨간색 [ERROR] 접두사와 함께 stderr에 출력한다', () => {
      logError('something failed');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[ERROR]');
      expect(output).toContain('something failed');
      expect(output).toContain('\x1b[31m');
      expect(output).toContain('\x1b[0m');
    });
  });

  describe('logDry', () => {
    it('시안색 [DRY] 접두사와 함께 stderr에 출력한다', () => {
      logDry('would copy file');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[DRY]');
      expect(output).toContain('would copy file');
      expect(output).toContain('\x1b[36m');
      expect(output).toContain('\x1b[0m');
    });
  });

  describe('출력 형식', () => {
    it('각 함수는 줄바꿈으로 끝난다', () => {
      logInfo('line');
      logSuccess('line');
      logWarn('line');
      logError('line');
      logDry('line');
      for (const call of stderrSpy.mock.calls) {
        expect((call[0] as string).endsWith('\n')).toBe(true);
      }
    });

    it('stdout에는 아무것도 출력하지 않는다', () => {
      const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
      logInfo('msg');
      logSuccess('msg');
      logWarn('msg');
      logError('msg');
      logDry('msg');
      expect(stdoutSpy).not.toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });
  });
});
