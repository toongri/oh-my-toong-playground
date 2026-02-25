import type { StdinInput } from './types.ts';

export async function readStdin(): Promise<StdinInput | null> {
  return new Promise((resolve) => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      try {
        const parsed = JSON.parse(data) as StdinInput;
        resolve(parsed);
      } catch {
        resolve(null);
      }
    });

    // Timeout after 100ms if no input
    setTimeout(() => {
      if (!data) resolve(null);
    }, 100);
  });
}
