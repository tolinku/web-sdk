import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Referrals } from '../src/referrals.js';
import type { HttpClient } from '../src/client.js';

function createMockClient(): HttpClient {
  return {
    baseUrl: 'https://api.example.com',
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({}),
    getPublic: vi.fn().mockResolvedValue({}),
    postPublic: vi.fn().mockResolvedValue({}),
    abort: vi.fn(),
  } as unknown as HttpClient;
}

describe('Referrals', () => {
  let client: ReturnType<typeof createMockClient>;
  let referrals: Referrals;

  beforeEach(() => {
    client = createMockClient();
    referrals = new Referrals(client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- URL encoding --

  it('should URL-encode referral codes in get()', async () => {
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ referrer_id: 'user-1' });

    await referrals.get('code with spaces/special&chars');

    expect(client.get).toHaveBeenCalledWith(
      '/v1/api/referral/code%20with%20spaces%2Fspecial%26chars',
    );
  });

  it('should handle simple referral codes', async () => {
    await referrals.get('ABC123');
    expect(client.get).toHaveBeenCalledWith('/v1/api/referral/ABC123');
  });

  // -- Create --

  it('should create a referral with userId', async () => {
    const result = { referral_code: 'REF123', referral_url: 'https://example.com/r/REF123', referral_id: 'id-1' };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(result);

    const response = await referrals.create({ userId: 'user-1' });

    expect(client.post).toHaveBeenCalledWith('/v1/api/referral/create', {
      user_id: 'user-1',
      metadata: undefined,
      user_name: undefined,
    });
    expect(response).toEqual(result);
  });

  it('should create a referral with optional metadata and userName', async () => {
    await referrals.create({
      userId: 'user-1',
      metadata: { tier: 'gold' },
      userName: 'Alice',
    });

    expect(client.post).toHaveBeenCalledWith('/v1/api/referral/create', {
      user_id: 'user-1',
      metadata: { tier: 'gold' },
      user_name: 'Alice',
    });
  });

  // -- Complete --

  it('should complete a referral', async () => {
    const result = {
      referral: {
        id: 'id-1',
        referrer_id: 'user-1',
        referred_user_id: 'user-2',
        status: 'completed',
        milestone: 'signup',
        completed_at: '2026-01-01T00:00:00Z',
        reward_type: null,
        reward_value: null,
      },
    };
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(result);

    const response = await referrals.complete({
      code: 'REF123',
      referredUserId: 'user-2',
      milestone: 'signup',
    });

    expect(client.post).toHaveBeenCalledWith('/v1/api/referral/complete', {
      referral_code: 'REF123',
      referred_user_id: 'user-2',
      milestone: 'signup',
      referred_user_name: undefined,
    });
    expect(response).toEqual(result);
  });

  // -- Milestone --

  it('should update a referral milestone', async () => {
    await referrals.milestone({ code: 'REF123', milestone: 'purchase' });

    expect(client.post).toHaveBeenCalledWith('/v1/api/referral/milestone', {
      referral_code: 'REF123',
      milestone: 'purchase',
    });
  });

  // -- Claim reward --

  it('should claim a referral reward', async () => {
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    const result = await referrals.claimReward('REF123');

    expect(client.post).toHaveBeenCalledWith('/v1/api/referral/claim-reward', {
      referral_code: 'REF123',
    });
    expect(result).toEqual({ success: true });
  });

  // -- Leaderboard --

  it('should fetch the leaderboard with default limit', async () => {
    const leaderboard = {
      leaderboard: [
        { referrer_id: 'user-1', referrer_name: 'Alice', total: 50, completed: 30 },
      ],
    };
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(leaderboard);

    const result = await referrals.leaderboard();

    expect(client.get).toHaveBeenCalledWith('/v1/api/referral/leaderboard', { limit: '25' });
    expect(result).toEqual(leaderboard);
  });

  it('should fetch the leaderboard with custom limit', async () => {
    await referrals.leaderboard(10);

    expect(client.get).toHaveBeenCalledWith('/v1/api/referral/leaderboard', { limit: '10' });
  });
});
