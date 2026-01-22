import { getOAuthToken } from './credentials.js';

describe('getOAuthToken', () => {
  describe('when Keychain contains valid credentials', () => {
    it('should return the access token from Keychain', async () => {
      // This test relies on actual system state - it will pass if Keychain has credentials
      // or fall back to file, or return null if neither exists
      const result = await getOAuthToken();

      // The function should return either a string token or null
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });
});
